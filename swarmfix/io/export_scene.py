"""JSON export for viewer scene and solver trace data."""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel

from swarmfix.models.results import PipelineResult

SCHEMA_VERSION = "0.1.0"


def _dump_model(model: BaseModel) -> dict:
    """Return a JSON-compatible Pydantic model dump."""
    dumped_model = model.model_dump(mode="json")
    return dumped_model


def scene_dict(result: PipelineResult) -> dict:
    """Convert a pipeline result to final-scene JSON data."""
    scene_data = {
        "schema_version": SCHEMA_VERSION,
        "metadata": {
            "scenario": result.scenario.name,
            "units": result.scenario.units,
            "dimension": result.scenario.dimension,
        },
        "truth": _truth_section(result),
        "measurements": _measurement_section(result),
        "estimates": _estimate_section(result),
        "metrics": {name: summary.values for name, summary in result.metrics.items()},
    }
    return scene_data


def trace_dict(result: PipelineResult) -> dict:
    """Convert a pipeline result to trace-rich JSON data."""
    trace_data = scene_dict(result)
    trace_data["trace"] = _trace_section(result)
    return trace_data


def _truth_section(result: PipelineResult) -> dict:
    """Return viewer truth nodes."""
    nodes = [
        {
            "id": agent.agent_id,
            "position_m": list(agent.position_m),
        }
        for agent in result.scenario.agents
    ]
    truth_data = {"nodes": nodes}
    return truth_data


def _measurement_section(result: PipelineResult) -> dict:
    """Return viewer-friendly measurement groups."""
    measurement_data = {
        "gnss": [
            {
                "agent_id": measurement.agent_id,
                "position_m": list(measurement.position_m),
                "sigma_m": measurement.sigma_m,
                "uncertainty": {
                    "type": "circle",
                    "radius_m": measurement.sigma_m,
                },
            }
            for measurement in result.measurements.gnss
        ],
        "uwb": [
            {
                "source_id": measurement.source_id,
                "target_id": measurement.target_id,
                "measured_distance_m": measurement.distance_m,
                "sigma_m": measurement.sigma_m,
                "true_distance_m": measurement.true_distance_m,
            }
            for measurement in result.measurements.uwb
        ],
        "references": [
            {
                "agent_id": reference.agent_id,
                "position_m": list(reference.position_m),
                "sigma_m": reference.sigma_m,
            }
            for reference in result.measurements.references
        ],
    }
    return measurement_data


def _estimate_section(result: PipelineResult) -> dict:
    """Return estimate positions grouped by method."""
    estimate_data = {}
    for method, estimate_set in result.estimates.items():
        estimate_data[method] = [
            {
                "agent_id": estimate.agent_id,
                "position_m": list(estimate.position_m),
            }
            for estimate in estimate_set.estimates
        ]
    return estimate_data


def _trace_section(result: PipelineResult) -> dict:
    """Return nested trace data for solver playback."""
    if result.solver_trace is None:
        return {"trace_type": "none", "iterations": []}
    iterations = []
    for iteration in result.solver_trace.iterations:
        iteration_data = {
            "iteration": iteration.iteration,
            "positions": {
                agent_id: list(position)
                for agent_id, position in iteration.positions.items()
            },
            "cost": {
                "total": iteration.cost_total,
                "gnss": iteration.cost_gnss,
                "uwb": iteration.cost_uwb,
                "reference": iteration.cost_reference,
            },
            "residuals": {
                "gnss": [_dump_model(residual) for residual in iteration.gnss_residuals],
                "uwb": [_dump_model(residual) for residual in iteration.uwb_residuals],
                "reference": [
                    _dump_model(residual)
                    for residual in iteration.reference_residuals
                ],
            },
        }
        iterations.append(iteration_data)
    trace_data = {
        "trace_type": result.solver_trace.trace_type,
        "iterations": iterations,
    }
    return trace_data


def export_scene_json(result: PipelineResult, output_path: str | Path) -> None:
    """Write final-scene JSON."""
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(scene_dict(result), indent=2, sort_keys=True), encoding="utf-8")


def export_solver_trace_json(result: PipelineResult, output_path: str | Path) -> None:
    """Write trace-rich scene JSON."""
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(trace_dict(result), indent=2, sort_keys=True), encoding="utf-8")
