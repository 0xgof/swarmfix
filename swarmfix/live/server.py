"""Small HTTP wrapper around the live Python solver."""

from __future__ import annotations

import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from swarmfix.estimation.solver_backend import (
    DEFAULT_SOLVER_BACKEND_NAME,
    SolverBackend,
    get_solver_backend,
)
from swarmfix.live.frame_builder import build_live_frame
from swarmfix.live.mission_action_api import (
    build_catalog_response,
    build_positions_response,
)
from swarmfix.live.models import (
    LiveFrameRequest,
    LiveSolveRequest,
    MissionActionPositionsRequest,
)
from swarmfix.live.solve_request import solve_live_request
from swarmfix.observability.events import TraceContext
from swarmfix.observability.sink import JsonlSink, NoOpSink, ObservationSink


def observability_sink_for_trace(trace_context: TraceContext | None) -> ObservationSink:
    """Build a session-scoped live-solver sink from request trace context."""
    if trace_context is None:
        return NoOpSink()

    root_dir = Path(os.environ.get("SWARMFIX_OBSERVABILITY_ROOT", "logs/observability"))
    event_path = root_dir / trace_context.session_id / "trace_events.jsonl"
    sink = JsonlSink(event_path)
    return sink


class LiveSolveHandler(BaseHTTPRequestHandler):
    """HTTP handler exposing ``POST /live/frame`` and ``POST /solve``.

    ``/live/frame`` is the backend-owned normal-path boundary: the viewer
    sends mission intent and options and receives a solved render-ready
    frame. ``/solve`` stays available as the measurement-level API for
    diagnostics, replay, and clients that already have measurements.
    """

    server_version = "SwarmFixLiveSolve/0.1"

    def do_GET(self) -> None:
        """Expose a cheap health check for viewer connection state."""
        if self.path == "/health":
            self._write_json(200, {
                "status": "ok",
                "service": "swarmfix-live-solver",
                "schema_version": "0.1.0",
            })
            return

        if self.path == "/mission-actions/catalog":
            response = build_catalog_response()
            self._write_json(200, response.model_dump(mode="json"))
            return

        self._write_json(404, {"error": "not found"})

    def do_OPTIONS(self) -> None:
        """Return CORS preflight headers for browser clients."""
        self.send_response(204)
        self._send_common_headers()
        self.end_headers()

    def do_POST(self) -> None:
        """Run one live frame or solve request, or return a validation error."""
        if self.path == "/live/frame":
            try:
                body = self._read_json_body()
                request = LiveFrameRequest.model_validate(body)
                sink = observability_sink_for_trace(request.trace_context)
                response = build_live_frame(
                    request,
                    observability_sink=sink,
                    solver_backend=self._solver_backend(),
                )
                self._write_json(200, response.model_dump(mode="json"))
            except (json.JSONDecodeError, ValidationError, ValueError) as error:
                self._write_json(400, {"error": str(error)})
            return

        if self.path == "/mission-actions/positions":
            try:
                body = self._read_json_body()
                request = MissionActionPositionsRequest.model_validate(body)
                response = build_positions_response(request)
                self._write_json(200, response.model_dump(mode="json"))
            except (json.JSONDecodeError, ValidationError, ValueError) as error:
                self._write_json(400, {"error": str(error)})
            return

        if self.path == "/health":
            self._discard_request_body()
            self._write_json(405, {"error": "method not allowed"})
            return

        if self.path != "/solve":
            self._write_json(404, {"error": "not found"})
            return

        try:
            body = self._read_json_body()
            request = LiveSolveRequest.model_validate(body)
            sink = observability_sink_for_trace(request.trace_context)
            response = solve_live_request(
                request,
                observability_sink=sink,
                solver_backend=self._solver_backend(),
            )
            self._write_json(200, response.model_dump())
        except (json.JSONDecodeError, ValidationError, ValueError) as error:
            self._write_json(400, {"error": str(error)})

    def _solver_backend(self) -> SolverBackend:
        """Return the server-selected solver backend or the default."""
        solver_backend = getattr(self.server, "solver_backend", None)
        if solver_backend is None:
            solver_backend = get_solver_backend()
        return solver_backend

    def _read_json_body(self) -> dict[str, Any]:
        """Read and parse one JSON request body."""
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length)
        parsed_body = json.loads(raw_body.decode("utf-8"))
        if not isinstance(parsed_body, dict):
            raise ValueError("request body must be a JSON object")
        return parsed_body

    def _discard_request_body(self) -> None:
        """Drain a rejected request body before writing the HTTP response."""
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length > 0:
            self.rfile.read(content_length)

    def _send_common_headers(self) -> None:
        """Send JSON and CORS headers shared by all responses."""
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _write_json(self, status_code: int, payload: dict[str, Any]) -> None:
        """Write one JSON response."""
        encoded_payload = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self._send_common_headers()
        self.send_header("Content-Length", str(len(encoded_payload)))
        self.end_headers()
        self.wfile.write(encoded_payload)


class LiveSolveServer(ThreadingHTTPServer):
    """HTTP server carrying the selected live-solver backend."""

    daemon_threads = True
    block_on_close = False

    def __init__(self,
                 server_address: tuple[str, int],
                 handler_class: type[BaseHTTPRequestHandler],
                 solver_backend: SolverBackend) -> None:
        super().__init__(server_address, handler_class)
        self.solver_backend = solver_backend


def create_live_server(host: str = "127.0.0.1",
                       port: int = 8765,
                       solver_backend_name: str | None = None) -> LiveSolveServer:
    """Create a live-solver server after validating backend selection."""
    solver_backend = get_solver_backend(solver_backend_name)
    server = LiveSolveServer((host, port), LiveSolveHandler, solver_backend)
    return server


def run_server(host: str = "127.0.0.1",
               port: int = 8765,
               solver_backend_name: str | None = None) -> None:
    """Serve live solver requests until the process is interrupted."""
    server = create_live_server(
        host=host,
        port=port,
        solver_backend_name=solver_backend_name,
    )
    try:
        server.serve_forever()
    finally:
        server.server_close()


def build_parser() -> argparse.ArgumentParser:
    """Build the live-solver HTTP server command-line parser."""
    parser = argparse.ArgumentParser(
        description="Run the SwarmFix live solver HTTP server for the viewer."
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Interface to bind. Use 127.0.0.1 for local viewer development."
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8765,
        help="Port for /health and /solve. The viewer defaults to 8765."
    )
    parser.add_argument(
        "--solver-backend",
        default=os.environ.get("SWARMFIX_SOLVER_BACKEND", DEFAULT_SOLVER_BACKEND_NAME),
        help=(
            "Solver backend name. Defaults to c-uwb-gnss; use python-scipy "
            "explicitly for reference checks."
        )
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """Run the live solver HTTP server from the command line."""
    parser = build_parser()
    args = parser.parse_args(argv)
    run_server(
        host=args.host,
        port=args.port,
        solver_backend_name=args.solver_backend,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
