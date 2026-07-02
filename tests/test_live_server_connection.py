"""Connection-hardening tests for the Python live solver HTTP server."""

from __future__ import annotations

import json
import threading
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import tomllib

import pytest

from swarmfix.live.server import LiveSolveHandler


def _serve_for_test() -> tuple[ThreadingHTTPServer, str]:
    """Start a local live-solver server for one test."""
    server = ThreadingHTTPServer(("127.0.0.1", 0), LiveSolveHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    base_url = f"http://{host}:{port}"
    return server, base_url


def test_live_server_health_endpoint_returns_service_status() -> None:
    """The viewer should be able to check backend health before solving."""
    server, base_url = _serve_for_test()
    try:
        with urlopen(f"{base_url}/health", timeout=2) as response:
            payload = json.loads(response.read().decode("utf-8"))
            headers = response.headers
    finally:
        server.shutdown()
        server.server_close()

    assert payload == {
        "status": "ok",
        "service": "swarmfix-live-solver",
        "schema_version": "0.1.0",
    }
    assert headers["Access-Control-Allow-Origin"] == "*"


def test_live_server_health_endpoint_rejects_post() -> None:
    """Health checks should be cheap GET requests, not solve-style POSTs."""
    server, base_url = _serve_for_test()
    request = Request(f"{base_url}/health", data=b"{}", method="POST")
    try:
        try:
            urlopen(request, timeout=2)
        except HTTPError as error:
            status_code = error.code
        else:
            status_code = 200
    finally:
        server.shutdown()
        server.server_close()

    assert status_code == 405


def test_pyproject_declares_live_solver_console_script() -> None:
    """Local development should expose a direct live-solver startup command."""
    with open("pyproject.toml", "rb") as pyproject_file:
        pyproject_data = tomllib.load(pyproject_file)

    scripts = pyproject_data["project"]["scripts"]
    assert scripts["swarmfix-live-server"] == "swarmfix.live.server:main"


def test_live_server_rejects_unknown_solver_backend_before_serving() -> None:
    """Startup should fail clearly before a misconfigured server handles requests."""
    from swarmfix.live.server import create_live_server

    with pytest.raises(ValueError, match="unknown solver backend"):
        create_live_server(host="127.0.0.1", port=0, solver_backend_name="missing")


def test_live_server_parser_defaults_to_c_solver_backend() -> None:
    """Starting the live server without an override should select the C backend."""
    from swarmfix.live.server import build_parser

    args = build_parser().parse_args([])

    assert args.solver_backend == "c-uwb-gnss"


def test_live_server_env_override_can_select_python_backend(monkeypatch) -> None:
    """Developers should still be able to choose the Python reference backend."""
    from swarmfix.live.server import build_parser

    monkeypatch.setenv("SWARMFIX_SOLVER_BACKEND", "python-scipy")

    args = build_parser().parse_args([])

    assert args.solver_backend == "python-scipy"
