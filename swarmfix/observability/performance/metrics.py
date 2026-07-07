"""Typed performance metric samples."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator


class PerformanceMetric(BaseModel):
    """One timing or count sample emitted by Python or the viewer."""

    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    trace_id: str
    span_id: str
    component: str
    metric_name: str
    duration_ms: float
    slow_threshold_ms: float | None = None
    fields: dict[str, Any] = Field(default_factory=dict)

    @field_validator("duration_ms")
    @classmethod
    def validate_duration(cls, duration_ms: float) -> float:
        """Reject negative durations."""
        if duration_ms < 0.0:
            raise ValueError("duration_ms must be non-negative")
        return duration_ms

    @field_validator("fields")
    @classmethod
    def validate_fields(cls, fields: dict[str, Any]) -> dict[str, Any]:
        """Require JSON-compatible diagnostic fields."""
        try:
            json.dumps(fields)
        except TypeError as error:
            raise ValueError("fields must be JSON-compatible") from error
        return fields

    @property
    def is_slow(self) -> bool:
        """Return whether this sample exceeds its configured threshold."""
        if self.slow_threshold_ms is None:
            return False
        is_slow_sample = self.duration_ms > self.slow_threshold_ms
        return is_slow_sample
