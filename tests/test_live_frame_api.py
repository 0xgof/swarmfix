"""Behavior tests for the backend-owned live frame endpoint.

BLF-004: ``POST /live/frame`` builds the sensor snapshot, selects UWB links,
runs the solver through the existing backend boundary, and returns a
render-ready frame. The viewer sends intent and options only; measurement
generation stays backend-side. ``POST /solve`` remains the measurement-level
API underneath.
"""

from __future__ import annotations

import json
import threading
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from swarmfix.estimation.solver_backend import get_solver_backend
from swarmfix.live.frame_builder import build_live_frame
from swarmfix.live.models import LiveFrameRequest, LiveSelectionOptions, SelectedUwbLink
from swarmfix.live.server import LiveSolveHandler
from swarmfix.live.uwb_selection import stable_uwb_endpoint_key


class RecordingSink:
    """Observability sink that records emitted events for assertions."""

    def __init__(self) -> None:
        self.events = []

    def emit(self, event) -> None:
        self.events.append(event)


def make_live_frame_request(max_uwb_links_per_agent: int = 3,
                            selection_options: LiveSelectionOptions | None = None,
                            time_s: float = 1.0) -> LiveFrameRequest:
    """Return a static grid live-frame request for four agents."""
    request = LiveFrameRequest(
        agent_ids=["agent_1", "agent_2", "agent_3", "agent_4"],
        time_s=time_s,
        mission_action={"formation": "grid", "motion": "static"},
        max_uwb_links_per_agent=max_uwb_links_per_agent,
        selection_options=selection_options or LiveSelectionOptions(),
    )
    return request


def python_backend():
    """Pin the Python reference backend for deterministic solve behavior."""
    return get_solver_backend("python-scipy")


def test_live_frame_returns_solved_render_ready_frame_for_static_grid() -> None:
    request = make_live_frame_request()

    response = build_live_frame(request, solver_backend=python_backend())

    assert response.schema_version == request.schema_version
    assert response.metadata.formation == "grid"
    assert response.metadata.motion == "static"
    assert response.metadata.time_s == 1.0
    assert len(response.truth) == 4
    assert len(response.measurements.gnss) == 4
    assert len(response.selected_uwb_links) > 0
    assert len(response.estimates.fused) == 4
    assert len(response.estimates.gnss_only) == 4
    assert len(response.trace.iterations) >= 1
    assert response.quality is not None
    assert response.metadata.selected_uwb_count == len(response.selected_uwb_links)


def test_live_frame_solver_uwb_constraints_match_backend_selection() -> None:
    request = make_live_frame_request()

    response = build_live_frame(request, solver_backend=python_backend())

    selected_pairs = {
        stable_uwb_endpoint_key(link.source_id, link.target_id)
        for link in response.selected_uwb_links
    }
    measurement_pairs = {
        stable_uwb_endpoint_key(measurement.source_id, measurement.target_id)
        for measurement in response.measurements.uwb
    }
    constraint_pairs = {
        stable_uwb_endpoint_key(edge.source_id, edge.target_id)
        for edge in response.constraints.edges
    }
    assert measurement_pairs == selected_pairs
    assert constraint_pairs == selected_pairs
    assert response.uwb_selection.selected_link_count == len(selected_pairs)


def test_live_frame_uwb_cap_changes_backend_selected_constraints() -> None:
    low_cap_response = build_live_frame(
        make_live_frame_request(max_uwb_links_per_agent=1),
        solver_backend=python_backend(),
    )
    high_cap_response = build_live_frame(
        make_live_frame_request(max_uwb_links_per_agent=3),
        solver_backend=python_backend(),
    )

    low_cap_count = len(low_cap_response.selected_uwb_links)
    high_cap_count = len(high_cap_response.selected_uwb_links)
    assert low_cap_count < high_cap_count
    assert low_cap_response.uwb_selection.max_links_per_agent == 1


def test_live_frame_moving_mission_changes_truth_with_time() -> None:
    early_response = build_live_frame(
        make_live_frame_request(time_s=0.0),
        solver_backend=python_backend(),
    )
    request_late = LiveFrameRequest(
        agent_ids=["agent_1", "agent_2", "agent_3", "agent_4"],
        time_s=4.0,
        mission_action={"formation": "grid", "motion": "forward", "speed_mps": 2.0},
        max_uwb_links_per_agent=3,
    )

    late_response = build_live_frame(request_late, solver_backend=python_backend())

    early_truth = {state.agent_id: state.position_m for state in early_response.truth}
    late_truth = {state.agent_id: state.position_m for state in late_response.truth}
    assert early_truth != late_truth


def test_live_frame_retains_echoed_previous_links_for_static_formation() -> None:
    first_response = build_live_frame(
        make_live_frame_request(),
        solver_backend=python_backend(),
    )
    previous_links = [
        SelectedUwbLink(source_id=link.source_id, target_id=link.target_id)
        for link in first_response.selected_uwb_links
    ]

    second_response = build_live_frame(
        make_live_frame_request(
            selection_options=LiveSelectionOptions(
                previous_selected_links=previous_links,
            ),
        ),
        solver_backend=python_backend(),
    )

    reasons = {link.selection_reason for link in second_response.selected_uwb_links}
    assert reasons == {"retained"}
    assert second_response.uwb_selection.added_links == 0
    assert second_response.uwb_selection.dropped_links == 0


def test_live_frame_emits_frame_selection_solve_and_quality_events() -> None:
    sink = RecordingSink()

    build_live_frame(
        make_live_frame_request(),
        observability_sink=sink,
        solver_backend=python_backend(),
    )

    event_names = [event.event for event in sink.events]
    assert "live_frame_request_started" in event_names
    assert "live_frame_snapshot_built" in event_names
    assert "live_frame_uwb_selected" in event_names
    assert "live_solve_completed" in event_names
    assert "live_frame_completed" in event_names
    assert event_names.index("live_frame_request_started") < event_names.index(
        "live_frame_snapshot_built"
    )
    assert event_names.index("live_frame_uwb_selected") < event_names.index(
        "live_frame_completed"
    )
    completed_event = sink.events[event_names.index("live_frame_completed")]
    assert completed_event.duration_ms is not None


def test_live_frame_failure_emits_failure_event_and_raises() -> None:
    sink = RecordingSink()
    invalid_request = LiveFrameRequest(
        agent_ids=["agent_1", "agent_2", "agent_3"],
        time_s=0.0,
        mission_action={"formation": "square_patrol", "motion": "static"},
        max_uwb_links_per_agent=3,
    )

    try:
        build_live_frame(
            invalid_request,
            observability_sink=sink,
            solver_backend=python_backend(),
        )
        raised = False
    except ValueError:
        raised = True

    assert raised
    event_names = [event.event for event in sink.events]
    assert "live_frame_failed" in event_names


def serve_for_test() -> tuple[ThreadingHTTPServer, str]:
    """Start a local live-solver server for one HTTP test."""
    server = ThreadingHTTPServer(("127.0.0.1", 0), LiveSolveHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    base_url = f"http://{host}:{port}"
    return server, base_url


def post_json(base_url: str,
              path: str,
              payload: dict) -> tuple[int, dict]:
    """POST one JSON payload and return (status code, parsed body)."""
    request = Request(
        f"{base_url}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8"))
            return response.status, body
    except HTTPError as error:
        body = json.loads(error.read().decode("utf-8"))
        return error.code, body


def test_live_frame_endpoint_returns_solved_frame_over_http() -> None:
    server, base_url = serve_for_test()
    try:
        status_code, body = post_json(base_url, "/live/frame", {
            "agent_ids": ["agent_1", "agent_2", "agent_3"],
            "time_s": 0.5,
            "mission_action": {"formation": "grid", "motion": "static"},
            "max_uwb_links_per_agent": 2,
        })
    finally:
        server.shutdown()
        server.server_close()

    assert status_code == 200
    assert len(body["truth"]) == 3
    assert len(body["measurements"]["gnss"]) == 3
    assert body["uwb_selection"]["selected_link_count"] == len(body["selected_uwb_links"])
    assert body["metadata"]["formation"] == "grid"
    assert body["estimates"]["fused"]


def test_live_frame_endpoint_rejects_invalid_mission_action_with_400() -> None:
    server, base_url = serve_for_test()
    try:
        status_code, body = post_json(base_url, "/live/frame", {
            "agent_ids": ["agent_1", "agent_2"],
            "time_s": 0.0,
            "mission_action": {"formation": "spiral"},
            "max_uwb_links_per_agent": 2,
        })
    finally:
        server.shutdown()
        server.server_close()

    assert status_code == 400
    assert "formation" in body["error"]


def test_live_frame_endpoint_rejects_invalid_uwb_cap_with_400() -> None:
    server, base_url = serve_for_test()
    try:
        status_code, body = post_json(base_url, "/live/frame", {
            "agent_ids": ["agent_1", "agent_2"],
            "time_s": 0.0,
            "max_uwb_links_per_agent": -2,
        })
    finally:
        server.shutdown()
        server.server_close()

    assert status_code == 400
    assert "max_uwb_links_per_agent" in body["error"]


def test_solve_endpoint_still_accepts_measurement_level_requests() -> None:
    server, base_url = serve_for_test()
    try:
        status_code, body = post_json(base_url, "/solve", {
            "dimension": 3,
            "agents": [
                {"agent_id": "a", "position_m": [0.0, 0.0, 0.0]},
                {"agent_id": "b", "position_m": [4.0, 0.0, 0.0]},
            ],
            "gnss": [
                {"agent_id": "a", "position_m": [0.4, 0.0, 0.0], "sigma_m": 1.2},
                {"agent_id": "b", "position_m": [4.3, 0.0, 0.0], "sigma_m": 1.2},
            ],
            "uwb": [
                {
                    "source_id": "a",
                    "target_id": "b",
                    "distance_m": 4.0,
                    "sigma_m": 0.15,
                },
            ],
        })
    finally:
        server.shutdown()
        server.server_close()

    assert status_code == 200
    assert len(body["estimates"]["fused"]) == 2
