"""Command-line interface for running SwarmFix pipeline configs."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from swarmfix.io.export_scene import export_scene_json, export_solver_trace_json
from swarmfix.observability.events import ObservationEvent
from swarmfix.observability.session import create_observability_session
from swarmfix.observability.sink import JsonlSink
from swarmfix.observability.summary import write_session_summaries
from swarmfix.workflow.run_pipeline import run_pipeline


def build_parser() -> argparse.ArgumentParser:
    """Build the CLI argument parser."""
    parser = argparse.ArgumentParser(
        prog="swarmfix-run",
        description="Run a SwarmFix TOML config and export scene JSON files.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Arguments and flags:\n"
            "  config: path to the SwarmFix TOML config to run.\n"
            "  --output-dir: output folder for scene.json and scene_trace.json.\n"
            "  --help: show this help text and exit.\n\n"
            "Examples:\n"
            "  python -m swarmfix.cli configs\\04_mission_reference.toml --output-dir outputs\\mission_reference\n"
            "  swarmfix-run configs\\03_common_bias_failure.toml --output-dir outputs\\common_bias_failure\n\n"
            "Default output:\n"
            "  If --output-dir is omitted, files are written to outputs/<config-stem>/."
        ),
    )
    parser.add_argument(
        "config",
        help="Path to a SwarmFix TOML config.",
    )
    parser.add_argument(
        "--output-dir",
        default=None,
        help="Output directory for scene.json and scene_trace.json.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """Run a SwarmFix TOML config from the command line.

    This is the central CLI entry point. It loads one validated TOML config,
    runs the end-to-end SwarmFix pipeline, exports viewer-ready JSON files, and
    prints a concise run summary with metrics.

    Usage:

    ```powershell
    python -m swarmfix.cli <config> [--output-dir <dir>]
    swarmfix-run <config> [--output-dir <dir>]
    ```

    Arguments and flags:

    config: Required positional argument. Path to the SwarmFix TOML config file
        to execute, for example configs/04_mission_reference.toml.

    --output-dir: Optional output directory. The command writes scene.json and
        scene_trace.json inside this directory. If omitted, the output
        directory defaults to outputs/<config-stem>/.
    --help: Show argparse usage text and exit without running the pipeline.


    Output files:

    scene.json: Final scenario, measurements, estimates, and metrics.
    scene_trace.json: scene.json data plus recorded least-squares trace states.

    Runtime steps:

    1. Parse CLI arguments.
    2. Load and validate the TOML config.
    3. Build the scenario and simulated GNSS/UWB/reference measurements.
    4. Run GNSS-only and GNSS/UWB fusion estimates.
    5. Apply mission reference correction when references are configured.
    6. Compute absolute and relative metrics.
    7. Export scene and solver-trace JSON files.
    8. Print scenario size, measurement counts, estimate names, trace length,
       and per-estimate RMSE values.

    Examples:

    ```powershell
    python -m swarmfix.cli configs/04_mission_reference.toml --output-dir outputs/mission_reference
    python -m swarmfix.cli configs/03_common_bias_failure.toml
    swarmfix-run configs/01_square_static.toml --output-dir outputs/square_static
    ```

    Args:
        argv: Optional argument list for programmatic invocation. Use `None` for
            normal command-line execution. Example:
            `["configs/04_mission_reference.toml", "--output-dir",
            "outputs/mission_reference"]`.

    Returns:
        `0` after a successful run. Argument errors are handled by `argparse`,
        which prints usage text and exits with code `2` in command-line mode.
    """
    parser = build_parser()
    args = parser.parse_args(argv)

    config_path = Path(args.config)
    output_dir = (
        Path(args.output_dir)
        if args.output_dir is not None
        else Path("outputs") / config_path.stem
    )
    observability_root = Path(
        os.environ.get("SWARMFIX_OBSERVABILITY_ROOT", "logs/observability")
    )
    session = create_observability_session(
        root_dir=observability_root,
        component="cli",
        scenario=config_path.stem,
        mode=os.environ.get("SWARMFIX_LOG_MODE", "normal"),
    )
    trace_context = session.trace_context(
        span_id="cli-run",
        correlation_id=config_path.stem,
    )
    sink = JsonlSink(session.session_dir / "trace_events.jsonl")
    sink.emit(ObservationEvent.from_context(
        trace_context,
        component="cli",
        event="cli_run_started",
        fields={
            "config_path": str(config_path),
            "output_dir": str(output_dir),
        },
    ))

    try:
        result = run_pipeline(config_path)
        scene_path = output_dir / "scene.json"
        trace_path = output_dir / "scene_trace.json"
        export_scene_json(result, scene_path)
        export_solver_trace_json(result, trace_path)
        for artifact_path in (scene_path, trace_path):
            sink.emit(ObservationEvent.from_context(
                trace_context,
                component="cli",
                event="cli_artifact_written",
                fields={"artifact_path": str(artifact_path)},
            ))
        sink.emit(ObservationEvent.from_context(
            trace_context,
            component="cli",
            event="cli_run_completed",
            fields={"scenario": result.scenario.name},
        ))
        write_session_summaries(session.session_dir)
    except Exception as error:
        sink.emit(ObservationEvent.from_context(
            trace_context,
            component="cli",
            event="cli_run_failed",
            fields={
                "error_type": type(error).__name__,
                "error": str(error),
            },
        ))
        write_session_summaries(session.session_dir)
        raise

    print("Run complete")
    print(f"Scenario: {result.scenario.name}")
    print(f"Agents: {len(result.scenario.agents)}")
    print(f"GNSS measurements: {len(result.measurements.gnss)}")
    print(f"UWB measurements: {len(result.measurements.uwb)}")
    print(f"Reference measurements: {len(result.measurements.references)}")
    print(f"Estimates: {', '.join(sorted(result.estimates))}")
    if result.solver_trace is not None:
        print(f"Solver trace states: {len(result.solver_trace.iterations)}")

    for name, summary in result.metrics.items():
        values = summary.values
        absolute_rmse = values["absolute_rmse"]
        relative_rmse = values["relative_rmse"]
        print(f"{name}: absolute_rmse={absolute_rmse:.6f}, relative_rmse={relative_rmse:.6f}")

    print(f"Scene JSON: {scene_path}")
    print(f"Trace JSON: {trace_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
