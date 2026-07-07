"""Command-line helper for executing every SwarmFix config in a folder."""

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
    """Build the parser for the run-all-configs command."""
    parser = argparse.ArgumentParser(
        prog="swarmfix-run-all",
        description="Run every SwarmFix TOML config in a folder.",
    )
    parser.add_argument(
        "config_dir",
        nargs="?",
        default="configs",
        help="Directory containing .toml configs to execute.",
    )
    parser.add_argument(
        "--output-root",
        default="outputs",
        help="Root directory where one output folder per config will be written.",
    )
    return parser


def run_config_file(config_path: Path, output_root: Path) -> None:
    """Run one config and write scene artifacts under the output root."""
    pipeline_result = run_pipeline(config_path)
    config_output_dir = output_root / config_path.stem
    scene_path = config_output_dir / "scene.json"
    trace_path = config_output_dir / "scene_trace.json"
    export_scene_json(pipeline_result, scene_path)
    export_solver_trace_json(pipeline_result, trace_path)


def main(argv: list[str] | None = None) -> int:
    """Run all TOML configs in a directory.

    Usage:

    ```powershell
    python -m swarmfix.run_all_configs configs --output-root outputs
    swarmfix-run-all configs --output-root outputs
    ```

    Arguments and flags:

    config_dir: Optional directory containing `.toml` configs. Defaults to
        `configs`.
    --output-root: Optional root directory for generated output folders.
        Defaults to `outputs`.

    The command runs config files in filename order. Each config writes:

    ```text
    <output-root>/<config-stem>/scene.json
    <output-root>/<config-stem>/scene_trace.json
    ```

    Returns:
        `0` when every config succeeds. Returns `1` if any config fails or if
        the config directory contains no TOML files.
    """
    parser = build_parser()
    args = parser.parse_args(argv)

    config_dir = Path(args.config_dir)
    output_root = Path(args.output_root)
    observability_root = Path(
        os.environ.get("SWARMFIX_OBSERVABILITY_ROOT", "logs/observability")
    )
    session = create_observability_session(
        root_dir=observability_root,
        component="run-all-configs",
        scenario=config_dir.name,
        mode=os.environ.get("SWARMFIX_LOG_MODE", "normal"),
    )
    trace_context = session.trace_context(
        span_id="run-all",
        correlation_id=config_dir.name,
    )
    sink = JsonlSink(session.session_dir / "trace_events.jsonl")
    sink.emit(ObservationEvent.from_context(
        trace_context,
        component="run-all-configs",
        event="run_all_started",
        fields={
            "config_dir": str(config_dir),
            "output_root": str(output_root),
        },
    ))
    config_paths = sorted(config_dir.glob("*.toml"))
    if not config_paths:
        sink.emit(ObservationEvent.from_context(
            trace_context,
            component="run-all-configs",
            event="run_all_failed",
            fields={"error": f"No TOML configs found in {config_dir}"},
        ))
        write_session_summaries(session.session_dir)
        print(f"No TOML configs found in {config_dir}")
        return 1

    failed_configs = []
    for config_path in config_paths:
        try:
            run_config_file(config_path, output_root)
        except Exception as exc:
            failed_configs.append(config_path.name)
            sink.emit(ObservationEvent.from_context(
                trace_context,
                component="run-all-configs",
                event="run_all_config_failed",
                fields={
                    "config_path": str(config_path),
                    "error_type": type(exc).__name__,
                    "error": str(exc),
                },
            ))
            print(f"{config_path.name}: failed ({exc})")
        else:
            sink.emit(ObservationEvent.from_context(
                trace_context,
                component="run-all-configs",
                event="run_all_config_completed",
                fields={"config_path": str(config_path)},
            ))
            print(f"{config_path.name}: ok")

    exit_code = 1 if failed_configs else 0
    sink.emit(ObservationEvent.from_context(
        trace_context,
        component="run-all-configs",
        event="run_all_completed",
        fields={
            "failed_count": len(failed_configs),
            "exit_code": exit_code,
        },
    ))
    write_session_summaries(session.session_dir)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
