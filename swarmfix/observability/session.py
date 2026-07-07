"""Logging session creation for root-level observability artifacts."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from uuid import uuid4

from swarmfix.observability.events import TraceContext

LoggingMode = Literal["normal", "debug"]


@dataclass(frozen=True)
class ObservabilitySession:
    """One physical app, CLI, experiment, or viewer logging execution."""

    session_id: str
    trace_id: str
    session_dir: Path
    component: str
    scenario: str | None
    mode: LoggingMode
    started_at: datetime

    def trace_context(self, span_id: str,
                      request_id: str | None = None,
                      correlation_id: str | None = None) -> TraceContext:
        """Create a trace context inside this logging session."""
        trace_context = TraceContext(
            session_id=self.session_id,
            trace_id=self.trace_id,
            span_id=span_id,
            request_id=request_id,
            correlation_id=correlation_id,
            scenario=self.scenario,
        )
        return trace_context


def _validate_mode(mode: str) -> LoggingMode:
    """Return a supported logging mode or raise a clear error."""
    if mode not in {"normal", "debug"}:
        raise ValueError("logging mode must be 'normal' or 'debug'")
    logging_mode = mode
    return logging_mode  # type: ignore[return-value]


def create_observability_session(root_dir: Path = Path("logs/observability"),
                                 component: str = "unknown",
                                 scenario: str | None = None,
                                 mode: str = "normal") -> ObservabilitySession:
    """Create a fresh root-level observability session directory."""
    logging_mode = _validate_mode(mode)
    started_at = datetime.now(UTC)
    session_id = f"session-{started_at.strftime('%Y%m%d-%H%M%S')}-{uuid4().hex[:8]}"
    trace_id = f"trace-{uuid4().hex}"
    session_dir = root_dir / session_id
    session_dir.mkdir(parents=True, exist_ok=False)
    session = ObservabilitySession(
        session_id=session_id,
        trace_id=trace_id,
        session_dir=session_dir,
        component=component,
        scenario=scenario,
        mode=logging_mode,
        started_at=started_at,
    )
    metadata = {
        "session_id": session.session_id,
        "trace_id": session.trace_id,
        "component": session.component,
        "scenario": session.scenario,
        "mode": session.mode,
        "started_at": session.started_at.isoformat(),
        "session_dir": str(session.session_dir),
    }
    metadata_path = session.session_dir / "session_metadata.json"
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return session
