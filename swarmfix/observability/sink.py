"""Event sink implementations for observability records."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Protocol

from swarmfix.observability.events import ObservationEvent


class ObservationSink(Protocol):
    """Boundary for recording observability events."""

    def emit(self, event: ObservationEvent) -> None:
        """Record one observability event."""


class NoOpSink:
    """Sink that intentionally ignores events."""

    def emit(self, event: ObservationEvent) -> None:
        """Accept an event without recording it."""
        return None


class InMemorySink:
    """Test sink that keeps emitted events in insertion order."""

    def __init__(self) -> None:
        """Create an empty in-memory event sink."""
        self.events: list[ObservationEvent] = []

    def emit(self, event: ObservationEvent) -> None:
        """Append one event to the in-memory list."""
        self.events.append(event)


class JsonlSink:
    """Append observability events to a JSONL file."""

    def __init__(self, path: Path) -> None:
        """Create a JSONL sink and ensure the parent directory exists."""
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def emit(self, event: ObservationEvent) -> None:
        """Append one serialized event to the sink file."""
        serialized_event = json.dumps(
            event.model_dump(mode="json"),
            sort_keys=True,
        )
        with self.path.open("a", encoding="utf-8") as event_file:
            event_file.write(serialized_event + "\n")
