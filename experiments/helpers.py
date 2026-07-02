"""Shared helpers for runnable SwarmFix experiment scripts."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import matplotlib.pyplot as plt

from swarmfix.estimation.rigid_topology_fit import estimate_rigid_topology_fit
from swarmfix.evaluation.comparisons import compare_estimates
from swarmfix.io.export_scene import export_scene_json, export_solver_trace_json
from swarmfix.models.results import PipelineResult
from swarmfix.observability.events import ObservationEvent
from swarmfix.observability.session import create_observability_session
from swarmfix.observability.sink import JsonlSink
from swarmfix.observability.summary import write_session_summaries
from swarmfix.visualisation.plot_cost_trace import plot_cost_trace
from swarmfix.visualisation.plot_errors import plot_error_vectors
from swarmfix.visualisation.plot_estimates import plot_estimates, plot_estimates_with_uwb_links
from swarmfix.workflow.run_pipeline import run_pipeline


def build_experiment_parser(description: str,
                            default_output_dir: str) -> argparse.ArgumentParser:
    """Create a consistent parser for experiment scripts."""
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument(
        "--output-dir",
        default=default_output_dir,
        help="Directory where experiment artifacts will be written.",
    )
    return parser


def run_and_export(config_path: str | Path,
                   output_dir: str | Path,
                   include_rigid_fit: bool = False,
                   write_plots: bool = False) -> PipelineResult:
    """Run a config, optionally enrich estimates, and write artifacts."""
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    observability_root = Path(
        os.environ.get("SWARMFIX_OBSERVABILITY_ROOT", "logs/observability")
    )
    session = create_observability_session(
        root_dir=observability_root,
        component="experiment",
        scenario=Path(config_path).stem,
        mode=os.environ.get("SWARMFIX_LOG_MODE", "normal"),
    )
    trace_context = session.trace_context(
        span_id="experiment-run",
        correlation_id=Path(config_path).stem,
    )
    sink = JsonlSink(session.session_dir / "trace_events.jsonl")
    sink.emit(ObservationEvent.from_context(
        trace_context,
        component="experiment",
        event="experiment_run_started",
        fields={
            "config_path": str(config_path),
            "output_dir": str(output_path),
        },
    ))
    try:
        pipeline_result = run_pipeline(config_path)
        if include_rigid_fit:
            rigid_fit = estimate_rigid_topology_fit(
                pipeline_result.scenario,
                pipeline_result.measurements,
            )
            estimates = dict(pipeline_result.estimates)
            estimates["rigid_topology_fit"] = rigid_fit
            metrics = compare_estimates(
                pipeline_result.scenario,
                estimates,
                solver_trace=pipeline_result.solver_trace,
                reference_available=bool(pipeline_result.measurements.references),
            )
            pipeline_result = pipeline_result.model_copy(
                update={"estimates": estimates, "metrics": metrics}
            )

        scene_path = output_path / "scene.json"
        trace_path = output_path / "scene_trace.json"
        export_scene_json(pipeline_result, scene_path)
        export_solver_trace_json(pipeline_result, trace_path)
        for artifact_path in (scene_path, trace_path):
            sink.emit(ObservationEvent.from_context(
                trace_context,
                component="experiment",
                event="experiment_artifact_written",
                fields={"artifact_path": str(artifact_path)},
            ))
        if write_plots:
            write_standard_plots(pipeline_result, output_path)
            for artifact_name in (
                "estimates.png",
                "estimates_uwb.png",
                "errors.png",
                "cost_trace.png",
            ):
                sink.emit(ObservationEvent.from_context(
                    trace_context,
                    component="experiment",
                    event="experiment_artifact_written",
                    fields={"artifact_path": str(output_path / artifact_name)},
                ))
        sink.emit(ObservationEvent.from_context(
            trace_context,
            component="experiment",
            event="experiment_run_completed",
            fields={"scenario": pipeline_result.scenario.name},
        ))
        write_session_summaries(session.session_dir)
        print_run_summary(pipeline_result, output_path)
        return pipeline_result
    except Exception as error:
        sink.emit(ObservationEvent.from_context(
            trace_context,
            component="experiment",
            event="experiment_run_failed",
            fields={
                "error_type": type(error).__name__,
                "error": str(error),
            },
        ))
        write_session_summaries(session.session_dir)
        raise


def write_standard_plots(result: PipelineResult, output_dir: Path) -> None:
    """Write the standard Python-side plots for a pipeline result."""
    estimate_figure = plot_estimates(result, output_dir / "estimates.png")
    estimate_uwb_figure = plot_estimates_with_uwb_links(
        result,
        output_dir / "estimates_uwb.png",
    )
    error_figure = plot_error_vectors(result, "fused", output_dir / "errors.png")
    cost_figure = plot_cost_trace(result.solver_trace, output_dir / "cost_trace.png")
    plt.close(estimate_figure)
    plt.close(estimate_uwb_figure)
    plt.close(error_figure)
    plt.close(cost_figure)


def print_run_summary(result: PipelineResult, output_dir: Path) -> None:
    """Print a concise experiment summary."""
    print("Run complete")
    print(f"Scenario: {result.scenario.name}")
    print(f"Agents: {len(result.scenario.agents)}")
    print(f"Estimates: {', '.join(sorted(result.estimates))}")
    for method, summary in result.metrics.items():
        absolute_rmse = summary.values["absolute_rmse"]
        relative_rmse = summary.values["relative_rmse"]
        print(f"{method}: absolute_rmse={absolute_rmse:.6f}, relative_rmse={relative_rmse:.6f}")
    print(f"Scene JSON: {output_dir / 'scene.json'}")
    print(f"Trace JSON: {output_dir / 'scene_trace.json'}")
