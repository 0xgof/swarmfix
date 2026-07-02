"""Typed trace contexts and event records for SwarmFix observability."""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator


JsonFields = dict[str, Any]


class TraceContext(BaseModel):
    """Correlation identifiers carried across viewer, API, and solver work."""

    session_id: str
    trace_id: str
    span_id: str
    parent_span_id: str | None = None
    correlation_id: str | None = None
    request_id: str | None = None
    run_id: str | None = None
    scenario: str | None = None

    def child(self, span_id: str,
              request_id: str | None = None,
              correlation_id: str | None = None) -> TraceContext:
        """Return a child context that inherits the current trace identifiers."""
        child_context = TraceContext(
            session_id=self.session_id,
            trace_id=self.trace_id,
            span_id=span_id,
            parent_span_id=self.span_id,
            correlation_id=correlation_id or self.correlation_id,
            request_id=request_id or self.request_id,
            run_id=self.run_id,
            scenario=self.scenario,
        )
        return child_context


class ObservationEvent(BaseModel):
    """One JSONL-safe observability event emitted at an orchestration boundary."""

    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    session_id: str
    trace_id: str
    span_id: str
    parent_span_id: str | None = None
    correlation_id: str | None = None
    request_id: str | None = None
    component: str
    event: str
    duration_ms: float | None = None
    fields: JsonFields = Field(default_factory=dict)

    @field_validator("event")
    @classmethod
    def validate_event_name(cls, event_name: str) -> str:
        """Require stable lower snake case event names."""
        if not re.fullmatch(r"[a-z][a-z0-9_]*", event_name):
            raise ValueError("event must be lower snake case")
        return event_name

    @field_validator("duration_ms")
    @classmethod
    def validate_duration(cls, duration_ms: float | None) -> float | None:
        """Reject negative durations because they cannot describe elapsed work."""
        if duration_ms is not None and duration_ms < 0.0:
            raise ValueError("duration_ms must be non-negative")
        return duration_ms

    @field_validator("fields")
    @classmethod
    def validate_fields(cls, fields: JsonFields) -> JsonFields:
        """Reject payload fields that cannot be written to JSONL."""
        try:
            json.dumps(fields)
        except TypeError as error:
            raise ValueError("fields must be JSON-compatible") from error
        return fields

    @classmethod
    def from_context(cls, trace_context: TraceContext,
                     component: str,
                     event: str,
                     duration_ms: float | None = None,
                     fields: JsonFields | None = None) -> ObservationEvent:
        """Create one event using identifiers from an existing trace context."""
        observation_event = cls(
            session_id=trace_context.session_id,
            trace_id=trace_context.trace_id,
            span_id=trace_context.span_id,
            parent_span_id=trace_context.parent_span_id,
            correlation_id=trace_context.correlation_id,
            request_id=trace_context.request_id,
            component=component,
            event=event,
            duration_ms=duration_ms,
            fields=fields or {},
        )
        return observation_event
