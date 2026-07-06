"""HTTP tests for the narrow backend mission-action API."""

from __future__ import annotations

import inspect
import json
import threading
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest


def _serve_for_test() -> tuple[ThreadingHTTPServer, str]:
    """Start a local live-solver server for one mission-action API test."""
    from swarmfix.live.server import LiveSolveHandler

    server = ThreadingHTTPServer(("127.0.0.1", 0), LiveSolveHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    base_url = f"http://{host}:{port}"
    return server, base_url


def _read_json_error(error: HTTPError) -> dict[str, object]:
    """Read a JSON error payload from an HTTPError."""
    payload = json.loads(error.read().decode("utf-8"))
    return payload


def test_mission_action_api_module_does_not_import_solver_or_sensor_paths() -> None:
    """Mission-action endpoint helpers must stay out of solver and sensor logic."""
    import swarmfix.live.mission_action_api as mission_action_api

    source = inspect.getsource(mission_action_api)

    assert "swarmfix.estimation" not in source
    assert "swarmfix.sensors" not in source
    assert "solve_live_request" not in source


def test_mission_action_catalog_endpoint_returns_only_catalog_data() -> None:
    """The catalog endpoint should not return a render-ready frame payload."""
    server, base_url = _serve_for_test()
    try:
        with urlopen(f"{base_url}/mission-actions/catalog", timeout=2) as response:
            payload = json.loads(response.read().decode("utf-8"))
            headers = response.headers
    finally:
        server.shutdown()
        server.server_close()

    assert headers["Access-Control-Allow-Origin"] == "*"
    assert payload["schema_version"] == "0.1.0"
    assert [option["id"] for option in payload["formations"]] == [
        "grid",
        "line",
        "column",
        "wedge",
        "ring",
        "square_patrol",
        "random_cloud",
    ]
    assert [option["id"] for option in payload["motions"]] == [
        "static",
        "random_walk",
        "forward",
        "path_follow",
    ]
    assert not {"truth", "measurements", "estimates", "trace", "constraints"} & payload.keys()


def test_mission_action_positions_endpoint_returns_positions_only() -> None:
    """The positions endpoint should move mission truth without generating sensors."""
    server, base_url = _serve_for_test()
    body = {
        "agent_ids": ["agent_0", "agent_1", "agent_2", "agent_3", "agent_4"],
        "time_s": 3.0,
        "mission_action": {
            "formation": "grid",
            "motion": "forward",
            "speed_mps": 2.0,
            "random_walk_amplitude_m": 0.24,
            "path": "loop",
            "previous_formation": None,
            "transition_started_at_s": None,
            "transition_duration_s": 2.0,
        },
    }
    request = Request(
        f"{base_url}/mission-actions/positions",
        data=json.dumps(body).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=2) as response:
            payload = json.loads(response.read().decode("utf-8"))
    finally:
        server.shutdown()
        server.server_close()

    assert payload["schema_version"] == "0.1.0"
    assert payload["metadata"] == {
        "formation": "grid",
        "motion": "forward",
        "time_s": 3.0,
    }
    assert payload["positions"][0]["agent_id"] == "agent_0"
    assert payload["positions"][0]["position_m"] == pytest.approx([3.0, 0.0, -1.5])
    assert not {"gnss", "uwb", "measurements", "estimates", "trace", "constraints"} & payload.keys()


def test_mission_action_positions_endpoint_rejects_invalid_action_state() -> None:
    """Invalid mission-action settings should fail before position generation."""
    server, base_url = _serve_for_test()
    body = {
        "agent_ids": ["agent_0"],
        "time_s": 0.0,
        "mission_action": {
            "formation": "grid",
            "motion": "forward",
            "speed_mps": -1.0,
        },
    }
    request = Request(
        f"{base_url}/mission-actions/positions",
        data=json.dumps(body).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        try:
            urlopen(request, timeout=2)
        except HTTPError as error:
            status_code = error.code
            payload = _read_json_error(error)
        else:
            status_code = 200
            payload = {}
    finally:
        server.shutdown()
        server.server_close()

    assert status_code == 400
    assert "speed_mps" in str(payload["error"])
