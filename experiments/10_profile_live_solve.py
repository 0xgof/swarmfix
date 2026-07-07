"""Profile the live solver hot path with a synthetic viewer-shaped request.

This script answers "where does live solve time go?" for the request shape the
Three.js viewer sends every scheduler tick. It reports single-solve wall time,
trace size, response payload size, and a cProfile breakdown of repeated solves.
"""

from __future__ import annotations

import argparse
import cProfile
import io
import json
import math
import pstats
import random
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from swarmfix.live.models import LiveSolveRequest
from swarmfix.live.solve_request import solve_live_request
from swarmfix.estimation.solver_backend import (
    DEFAULT_SOLVER_BACKEND_NAME,
    SolverBackend,
    get_solver_backend,
)


def build_synthetic_request(agent_count: int,
                            link_count: int,
                            max_iterations: int) -> LiveSolveRequest:
    """Build a deterministic live solve request shaped like a viewer tick."""
    random.seed(7)
    positions = {
        f"robot_{index}": [
            10 * math.cos(2 * math.pi * index / agent_count),
            10 * math.sin(2 * math.pi * index / agent_count),
            2.0 + 0.1 * index,
        ]
        for index in range(agent_count)
    }

    links = []
    for source_index in range(agent_count):
        for target_index in range(source_index + 1, agent_count):
            if len(links) >= link_count:
                break
            source_id = f"robot_{source_index}"
            target_id = f"robot_{target_index}"
            true_distance = math.dist(positions[source_id], positions[target_id])
            links.append({
                "source_id": source_id,
                "target_id": target_id,
                "distance_m": true_distance + random.gauss(0, 0.05),
                "sigma_m": 0.1,
                "true_distance_m": None,
            })

    request_payload = {
        "schema_version": "0.1.0",
        "dimension": 3,
        "agents": [
            {"agent_id": agent_id, "position_m": position}
            for agent_id, position in positions.items()
        ],
        "gnss": [
            {
                "agent_id": agent_id,
                "position_m": [coord + random.gauss(0, 0.5) for coord in position],
                "sigma_m": 1.0,
            }
            for agent_id, position in positions.items()
        ],
        "uwb": links,
        "selected_uwb_links": [
            {"source_id": link["source_id"], "target_id": link["target_id"]}
            for link in links
        ],
        "estimation": {
            "max_iterations": max_iterations,
            "robust_loss": "linear",
        },
    }
    request = LiveSolveRequest.model_validate(request_payload)
    return request


def report_single_solve(request: LiveSolveRequest,
                        solver_backend: SolverBackend) -> None:
    """Print wall time, trace size, and payload size for one solve."""
    started_seconds = time.perf_counter()
    response = solve_live_request(request, solver_backend=solver_backend)
    solve_ms = (time.perf_counter() - started_seconds) * 1000

    started_seconds = time.perf_counter()
    payload = response.model_dump()
    dump_ms = (time.perf_counter() - started_seconds) * 1000

    started_seconds = time.perf_counter()
    encoded_payload = json.dumps(payload)
    json_ms = (time.perf_counter() - started_seconds) * 1000

    print(f"single solve: {solve_ms:.1f} ms")
    print(f"trace iterations in response: {len(response.trace.iterations)}")
    print(f"response model_dump: {dump_ms:.1f} ms, json.dumps: {json_ms:.1f} ms")
    print(f"response payload: {len(encoded_payload) / 1024:.0f} KiB")


def report_profile(request: LiveSolveRequest,
                   solver_backend: SolverBackend,
                   repeat_count: int,
                   top_count: int) -> None:
    """Print a cProfile cumulative-time breakdown of repeated solves."""
    profiler = cProfile.Profile()
    profiler.enable()
    for _ in range(repeat_count):
        solve_live_request(request, solver_backend=solver_backend)
    profiler.disable()

    stream = io.StringIO()
    stats = pstats.Stats(profiler, stream=stream)
    stats.strip_dirs().sort_stats("cumulative").print_stats(top_count)
    print(stream.getvalue())


def build_parser() -> argparse.ArgumentParser:
    """Build the live solve profiling command-line parser."""
    parser = argparse.ArgumentParser(
        description="Profile the live solver with a synthetic viewer request."
    )
    parser.add_argument(
        "--agents",
        type=int,
        default=10,
        help="Number of agents in the synthetic swarm."
    )
    parser.add_argument(
        "--links",
        type=int,
        default=22,
        help="Number of selected UWB links (viewer default scene uses 22)."
    )
    parser.add_argument(
        "--max-iterations",
        type=int,
        default=40,
        help="Estimation budget passed as scipy max_nfev (viewer sends 40)."
    )
    parser.add_argument(
        "--repeat",
        type=int,
        default=5,
        help="Number of solves to run under the profiler."
    )
    parser.add_argument(
        "--top",
        type=int,
        default=22,
        help="Number of profile rows to print."
    )
    parser.add_argument(
        "--solver-backend",
        default=DEFAULT_SOLVER_BACKEND_NAME,
        help="Solver backend to benchmark, such as python-scipy or c-uwb-gnss."
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """Profile one warm live solve and a repeated profiled batch."""
    parser = build_parser()
    args = parser.parse_args(argv)
    request = build_synthetic_request(args.agents, args.links, args.max_iterations)
    solver_backend = get_solver_backend(args.solver_backend)

    # Warm-up excludes one-off import and numpy initialisation costs.
    solve_live_request(request, solver_backend=solver_backend)

    print(f"solver backend: {solver_backend.name}")
    report_single_solve(request, solver_backend)
    report_profile(request, solver_backend, args.repeat, args.top)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
