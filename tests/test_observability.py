"""Tests for session-scoped observability records and performance summaries."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from swarmfix.observability.events import ObservationEvent, TraceContext
from swarmfix.observability.performance.metrics import PerformanceMetric
from swarmfix.observability.performance.summary import summarize_metrics
from swarmfix.observability.session import create_observability_session
from swarmfix.observability.sink import JsonlSink, NoOpSink
from swarmfix.observability.summary import write_session_summaries


def test_observation_event_preserves_trace_context_and_writes_jsonl(tmp_path: Path) -> None:
    trace_context = TraceContext(
        session_id="session-test",
        trace_id="trace-test",
        span_id="span-test",
        correlation_id="scenario-links-3",
        request_id="solve-1",
    )
    event = ObservationEvent.from_context(
        trace_context,
        component="python-live-solver",
        event="live_solve_request_started",
        fields={"selected_uwb_links": 3},
    )
    sink = JsonlSink(tmp_path / "trace_events.jsonl")

    sink.emit(event)

    written_event = json.loads((tmp_path / "trace_events.jsonl").read_text().strip())
    assert written_event["session_id"] == "session-test"
    assert written_event["trace_id"] == "trace-test"
    assert written_event["span_id"] == "span-test"
    assert written_event["correlation_id"] == "scenario-links-3"
    assert written_event["fields"]["selected_uwb_links"] == 3


def test_observation_event_rejects_non_json_fields() -> None:
    trace_context = TraceContext(
        session_id="session-test",
        trace_id="trace-test",
        span_id="span-test",
    )

    with pytest.raises(ValidationError, match="JSON-compatible"):
        ObservationEvent.from_context(
            trace_context,
            component="python-live-solver",
            event="bad_event",
            fields={"path": Path("not-json")},
        )


def test_noop_sink_accepts_events_without_writing(tmp_path: Path) -> None:
    trace_context = TraceContext(
        session_id="session-test",
        trace_id="trace-test",
        span_id="span-test",
    )
    event = ObservationEvent.from_context(
        trace_context,
        component="workflow",
        event="pipeline_started",
    )
    sink = NoOpSink()

    sink.emit(event)

    assert list(tmp_path.iterdir()) == []


def test_create_observability_session_creates_unique_root_log_directory(
        tmp_path: Path) -> None:
    first_session = create_observability_session(
        root_dir=tmp_path,
        component="cli",
        scenario="demo",
        mode="normal",
    )
    second_session = create_observability_session(
        root_dir=tmp_path,
        component="cli",
        scenario="demo",
        mode="debug",
    )

    assert first_session.session_id != second_session.session_id
    assert first_session.session_dir.parent == tmp_path
    assert second_session.session_dir.parent == tmp_path
    assert (first_session.session_dir / "session_metadata.json").exists()
    assert (second_session.session_dir / "session_metadata.json").exists()
    metadata = json.loads((second_session.session_dir / "session_metadata.json").read_text())
    assert metadata["mode"] == "debug"
    assert metadata["component"] == "cli"


def test_create_observability_session_rejects_invalid_mode(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="logging mode"):
        create_observability_session(
            root_dir=tmp_path,
            component="cli",
            scenario="demo",
            mode="verbose",
        )


def test_observability_session_child_context_inherits_session_id(tmp_path: Path) -> None:
    session = create_observability_session(
        root_dir=tmp_path,
        component="viewer",
        scenario="grid",
        mode="normal",
    )

    child_context = session.trace_context(
        span_id="live-solve-1",
        request_id="solve-1",
        correlation_id="grid-links-7",
    )

    assert child_context.session_id == session.session_id
    assert child_context.trace_id == session.trace_id
    assert child_context.span_id == "live-solve-1"
    assert child_context.request_id == "solve-1"
    assert child_context.correlation_id == "grid-links-7"


def test_performance_summary_reports_percentiles_and_slow_counts() -> None:
    metrics = [
        PerformanceMetric(
            trace_id="trace-test",
            span_id=f"frame-{index}",
            component="viewer",
            metric_name="frame_ms",
            duration_ms=float(duration_ms),
            slow_threshold_ms=33.0,
        )
        for index, duration_ms in enumerate([10, 20, 30, 40, 100])
    ]

    summary = summarize_metrics(metrics)

    frame_summary = summary["frame_ms"]
    assert frame_summary["count"] == 5
    assert frame_summary["max"] == 100.0
    assert frame_summary["p50"] == 30.0
    assert frame_summary["p95"] == 100.0
    assert frame_summary["slow_count"] == 2


def test_performance_summary_handles_empty_samples() -> None:
    summary = summarize_metrics([])

    assert summary == {}


def test_performance_metric_rejects_negative_duration() -> None:
    with pytest.raises(ValidationError, match="duration_ms"):
        PerformanceMetric(
            trace_id="trace-test",
            span_id="frame-1",
            component="viewer",
            metric_name="frame_ms",
            duration_ms=-1.0,
        )


def test_write_session_summaries_creates_event_and_metric_summary_files(tmp_path: Path) -> None:
    session_dir = tmp_path / "session-test"
    session_dir.mkdir()
    (session_dir / "trace_events.jsonl").write_text(
        json.dumps({
            "event": "viewer_session_started",
            "session_id": "session-test",
            "trace_id": "trace-test",
            "span_id": "span-1",
            "component": "viewer",
            "fields": {},
        }) + "\n",
        encoding="utf-8",
    )
    (session_dir / "performance_samples.jsonl").write_text(
        json.dumps({
            "trace_id": "trace-test",
            "span_id": "frame-1",
            "component": "viewer",
            "metric_name": "frame_ms",
            "duration_ms": 40.0,
            "slow_threshold_ms": 33.0,
            "fields": {},
        }) + "\n",
        encoding="utf-8",
    )

    write_session_summaries(session_dir)

    event_summary = json.loads(
        (session_dir / "observability_summary.json").read_text(encoding="utf-8")
    )
    metric_summary = json.loads(
        (session_dir / "metrics_summary.json").read_text(encoding="utf-8")
    )
    assert event_summary["events"]["viewer_session_started"] == 1
    assert metric_summary["frame_ms"]["slow_count"] == 1
