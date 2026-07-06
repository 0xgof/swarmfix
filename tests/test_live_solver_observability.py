"""Observability tests for the live solver orchestration boundary."""

from __future__ import annotations

import pytest

from swarmfix.live.models import (
    LiveAgentState,
    LiveGnssMeasurement,
    LiveSolveRequest,
    LiveUwbMeasurement,
    SelectedUwbLink,
)
from swarmfix.live.solve_request import solve_live_request
from swarmfix.observability.events import TraceContext
from swarmfix.observability.sink import InMemorySink


def _python_backend() -> object:
    """Return the Python backend for observability tests with stable metadata."""
    from swarmfix.estimation.solver_backend import get_solver_backend

    backend = get_solver_backend("python-scipy")
    return backend


def _live_request() -> LiveSolveRequest:
    request = LiveSolveRequest(
        dimension=3,
        agents=[
            LiveAgentState(agent_id="a", position_m=(0.0, 0.0, 0.0)),
            LiveAgentState(agent_id="b", position_m=(4.0, 0.0, 0.0)),
            LiveAgentState(agent_id="c", position_m=(0.0, 3.0, 0.0)),
        ],
        gnss=[
            LiveGnssMeasurement(agent_id="a", position_m=(0.2, 0.0, 0.0), sigma_m=1.0),
            LiveGnssMeasurement(agent_id="b", position_m=(4.1, 0.1, 0.0), sigma_m=1.0),
            LiveGnssMeasurement(agent_id="c", position_m=(0.1, 3.2, 0.0), sigma_m=1.0),
        ],
        uwb=[
            LiveUwbMeasurement(source_id="a", target_id="b", distance_m=4.0, sigma_m=0.2),
            LiveUwbMeasurement(source_id="a", target_id="c", distance_m=3.0, sigma_m=0.2),
            LiveUwbMeasurement(source_id="b", target_id="c", distance_m=5.0, sigma_m=0.2),
        ],
        selected_uwb_links=[
            SelectedUwbLink(source_id="a", target_id="b"),
            SelectedUwbLink(source_id="a", target_id="c"),
        ],
    )
    return request


def test_live_solver_emits_traceable_success_events() -> None:
    trace_context = TraceContext(
        session_id="session-live",
        trace_id="trace-live",
        span_id="viewer-request-1",
        request_id="solve-1",
        correlation_id="grid-links-2",
    )
    sink = InMemorySink()
    request = _live_request()
    request.trace_context = trace_context

    response = solve_live_request(
        request,
        observability_sink=sink,
        solver_backend=_python_backend(),
    )

    event_names = [event.event for event in sink.events]
    assert event_names == [
        "live_solve_request_started",
        "live_solve_measurements_validated",
        "live_solve_selected_graph_built",
        "live_solve_completed",
    ]
    assert all(
        event.fields["solver_backend"] == "python-scipy"
        for event in sink.events
    )
    assert all(event.session_id == "session-live" for event in sink.events)
    assert all(event.trace_id == "trace-live" for event in sink.events)
    graph_event = sink.events[2]
    assert graph_event.fields["selected_uwb_count"] == 2
    assert graph_event.fields["graph_support"] == {
        "a": "chain",
        "b": "chain",
        "c": "chain",
    }
    assert response.metadata.trace_context is not None
    assert response.metadata.trace_context["session_id"] == "session-live"


def test_live_solver_records_solver_quality_against_gnss_baseline() -> None:
    """Completed solves should say whether fusion beat GNSS for that snapshot."""
    sink = InMemorySink()
    request = _live_request()

    response = solve_live_request(
        request,
        observability_sink=sink,
        solver_backend=_python_backend(),
    )

    completed_event = sink.events[-1]
    assert completed_event.event == "live_solve_completed"
    assert completed_event.fields["solve_error_rmse_m"] < completed_event.fields[
        "gnss_truth_error_rmse_m"
    ]
    assert completed_event.fields["solve_improvement_rmse_m"] > 0.0
    assert completed_event.fields["solve_error_ratio_to_gnss"] < 1.0
    assert completed_event.fields["fused_worse_than_gnss"] is False
    assert completed_event.fields["final_cost_total"] >= 0.0
    assert completed_event.fields["final_cost_gnss"] >= 0.0
    assert completed_event.fields["final_cost_uwb"] >= 0.0
    assert response.metadata.quality is not None
    assert response.metadata.quality.solve_error.rmse_m == pytest.approx(
        completed_event.fields["solve_error_rmse_m"]
    )


def test_live_solver_emits_failure_event_before_reraising_validation_error() -> None:
    trace_context = TraceContext(
        session_id="session-live",
        trace_id="trace-live",
        span_id="viewer-request-1",
    )
    sink = InMemorySink()
    request = _live_request()
    request.trace_context = trace_context
    request.gnss = request.gnss[:-1]

    with pytest.raises(ValueError, match="GNSS measurement"):
        solve_live_request(
            request,
            observability_sink=sink,
            solver_backend=_python_backend(),
        )

    assert sink.events[-1].event == "live_solve_failed"
    assert sink.events[-1].fields["solver_backend"] == "python-scipy"
    assert sink.events[-1].fields["error_type"] == "ValueError"
    assert "GNSS measurement" in sink.events[-1].fields["error"]


def test_live_solver_creates_root_trace_context_when_request_omits_it() -> None:
    sink = InMemorySink()

    response = solve_live_request(
        _live_request(),
        observability_sink=sink,
        solver_backend=_python_backend(),
    )

    assert sink.events[0].session_id.startswith("session-")
    assert sink.events[0].trace_id.startswith("trace-")
    assert response.metadata.trace_context is not None
    assert response.metadata.trace_context["session_id"] == sink.events[0].session_id


def test_live_server_builds_jsonl_sink_from_request_session(tmp_path, monkeypatch) -> None:
    from swarmfix.live.server import observability_sink_for_trace

    monkeypatch.setenv("SWARMFIX_OBSERVABILITY_ROOT", str(tmp_path))
    request = _live_request()
    request.trace_context = TraceContext(
        session_id="session-live",
        trace_id="trace-live",
        span_id="viewer-request-1",
    )
    sink = observability_sink_for_trace(request.trace_context)

    response = solve_live_request(
        request,
        observability_sink=sink,
        solver_backend=_python_backend(),
    )

    event_path = tmp_path / "session-live" / "trace_events.jsonl"
    assert event_path.is_file()
    event_text = event_path.read_text(encoding="utf-8")
    assert "live_solve_request_started" in event_text
    assert "live_solve_completed" in event_text
    assert response.metadata.trace_context["session_id"] == "session-live"
