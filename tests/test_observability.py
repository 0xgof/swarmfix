"""Tests for session-scoped observability records and performance summaries."""

from __future__ import annotations

import json
import tomllib
from pathlib import Path

import pytest
from pydantic import ValidationError

from swarmfix.observability.events import ObservationEvent, TraceContext
from swarmfix.observability.performance.metrics import PerformanceMetric
from swarmfix.observability.performance.summary import summarize_metrics
from swarmfix.observability.performance_baseline import (
    format_performance_baseline,
    summarize_performance_baseline,
)
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


def test_performance_baseline_summarizes_viewer_samples_and_backend_events(
        tmp_path: Path) -> None:
    viewer_session = tmp_path / "session-viewer"
    backend_session = tmp_path / "session-backend"
    viewer_session.mkdir()
    backend_session.mkdir()
    viewer_samples = [
        {
            "trace_id": "trace-viewer",
            "span_id": f"frame-{index}",
            "component": "viewer",
            "metric_name": "frame_ms",
            "duration_ms": duration_ms,
            "slow_threshold_ms": 33.0,
            "fields": {"selected_uwb_links": index},
        }
        for index, duration_ms in enumerate([10.0, 20.0, 30.0, 40.0, 100.0])
    ]
    viewer_samples.append({
        "trace_id": "trace-viewer",
        "span_id": "solve-1",
        "component": "viewer",
        "metric_name": "live_solve_ms",
        "duration_ms": 250.0,
        "slow_threshold_ms": 250.0,
        "fields": {"selected_uwb_links": 7},
    })
    (viewer_session / "performance_samples.jsonl").write_text(
        "".join(json.dumps(sample) + "\n" for sample in viewer_samples),
        encoding="utf-8",
    )
    backend_events = [
        {
            "event": "live_solve_completed",
            "session_id": "session-backend",
            "trace_id": "trace-backend",
            "span_id": f"solve-{index}",
            "component": "python-live-solver",
            "fields": {
                "duration_ms": duration_ms,
                "solver_backend": "c-uwb-gnss",
                "selected_uwb_links": index + 3,
            },
        }
        for index, duration_ms in enumerate([2.0, 4.0, 8.0])
    ]
    (backend_session / "trace_events.jsonl").write_text(
        "".join(json.dumps(event) + "\n" for event in backend_events),
        encoding="utf-8",
    )

    summary = summarize_performance_baseline(tmp_path)

    assert summary.viewer_session_path == viewer_session
    assert summary.backend_session_path == backend_session
    assert summary.viewer_metrics["frame_ms"]["count"] == 5
    assert summary.viewer_metrics["frame_ms"]["p95"] == 100.0
    assert summary.viewer_metrics["live_solve_ms"]["count"] == 1
    assert summary.viewer_phase_metrics == {}
    assert summary.backend_metrics["live_solve_completed"]["count"] == 3
    assert summary.backend_metrics["live_solve_completed"]["max"] == 8.0
    assert summary.solver_backends == ["c-uwb-gnss"]
    assert summary.selected_uwb_links == {
        "backend": [3, 4, 5],
        "viewer": [0, 1, 2, 3, 4, 7],
    }


def test_performance_baseline_reports_missing_session_files(tmp_path: Path) -> None:
    empty_session = tmp_path / "session-empty"
    empty_session.mkdir()

    summary = summarize_performance_baseline(tmp_path)
    formatted_summary = format_performance_baseline(summary)

    assert summary.diagnostics == [
        "no viewer performance_samples.jsonl found",
        "no backend trace_events.jsonl with live_solve_completed found",
    ]
    assert "no viewer performance_samples.jsonl found" in formatted_summary
    assert "no backend trace_events.jsonl with live_solve_completed found" in formatted_summary


def test_performance_baseline_keeps_viewer_and_backend_metrics_separate(
        tmp_path: Path) -> None:
    session = tmp_path / "session-mixed"
    session.mkdir()
    (session / "performance_samples.jsonl").write_text(
        json.dumps({
            "trace_id": "trace-viewer",
            "span_id": "solve-viewer",
            "component": "viewer",
            "metric_name": "live_solve_ms",
            "duration_ms": 300.0,
            "fields": {},
        }) + "\n",
        encoding="utf-8",
    )
    (session / "trace_events.jsonl").write_text(
        json.dumps({
            "event": "live_solve_completed",
            "session_id": "session-mixed",
            "trace_id": "trace-backend",
            "span_id": "solve-backend",
            "component": "python-live-solver",
            "fields": {
                "duration_ms": 5.0,
                "solver_backend": "c-uwb-gnss",
            },
        }) + "\n",
        encoding="utf-8",
    )

    summary = summarize_performance_baseline(tmp_path)

    assert summary.viewer_metrics["live_solve_ms"]["max"] == 300.0
    assert summary.backend_metrics["live_solve_completed"]["max"] == 5.0


def test_performance_baseline_reports_slow_frame_phase_metrics(tmp_path: Path) -> None:
    session = tmp_path / "session-viewer"
    session.mkdir()
    samples = [
        {
            "trace_id": "trace-viewer",
            "span_id": "frame-1",
            "component": "viewer",
            "metric_name": "frame_ms",
            "duration_ms": 80.0,
            "slow_threshold_ms": 33.0,
            "fields": {"selected_uwb_links": 40},
        },
        {
            "trace_id": "trace-viewer",
            "span_id": "frame-1:live_frame_build",
            "component": "viewer",
            "metric_name": "frame_phase_ms",
            "duration_ms": 22.0,
            "slow_threshold_ms": None,
            "fields": {
                "phase_name": "live_frame_build",
                "frame_span_id": "frame-1",
                "selected_uwb_links": 40,
            },
        },
        {
            "trace_id": "trace-viewer",
            "span_id": "frame-1:scene_update",
            "component": "viewer",
            "metric_name": "frame_phase_ms",
            "duration_ms": 41.0,
            "slow_threshold_ms": None,
            "fields": {
                "phase_name": "scene_update",
                "frame_span_id": "frame-1",
                "selected_uwb_links": 40,
            },
        },
    ]
    (session / "performance_samples.jsonl").write_text(
        "".join(json.dumps(sample) + "\n" for sample in samples),
        encoding="utf-8",
    )

    summary = summarize_performance_baseline(tmp_path)
    formatted_summary = format_performance_baseline(summary)

    assert summary.viewer_phase_metrics["live_frame_build"]["count"] == 1
    assert summary.viewer_phase_metrics["live_frame_build"]["max"] == 22.0
    assert summary.viewer_phase_metrics["scene_update"]["p95"] == 41.0
    assert "viewer slow-frame phases:" in formatted_summary
    assert "live_frame_build: n=1 p50=22.0ms" in formatted_summary
    assert "scene_update: n=1 p50=41.0ms" in formatted_summary


def test_pyproject_declares_performance_baseline_console_script() -> None:
    with open("pyproject.toml", "rb") as pyproject_file:
        pyproject_data = tomllib.load(pyproject_file)

    scripts = pyproject_data["project"]["scripts"]
    assert (
        scripts["swarmfix-performance-baseline"]
        == "swarmfix.observability.performance_baseline:main"
    )
