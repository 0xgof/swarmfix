"""Comparison summaries across estimate methods."""

from __future__ import annotations

from swarmfix.evaluation.metrics import (
    absolute_mae,
    absolute_rmse,
    bias_estimation_error,
    centroid_error,
    max_error,
    orientation_error,
    relative_rmse,
)
from swarmfix.models.estimates import EstimateSet
from swarmfix.models.metrics import MetricsSummary
from swarmfix.models.residuals import SolverTrace
from swarmfix.models.scenario import Scenario


def _safe_improvement(baseline: float, candidate: float) -> float:
    """Return fractional improvement or zero for a zero baseline."""
    if baseline == 0.0:
        return 0.0
    improvement = (baseline - candidate) / baseline
    return improvement


def compare_estimates(scenario: Scenario,
                      estimates: dict[str, EstimateSet],
                      solver_trace: SolverTrace | None = None,
                      reference_available: bool = False,
                      expected_common_bias_m: tuple[float, ...] | None = None) -> dict[str, MetricsSummary]:
    """Compute metric summaries for all available estimate sets."""
    summaries = {}
    baseline_absolute = None
    if "gnss_only" in estimates:
        baseline_absolute = absolute_rmse(scenario, estimates["gnss_only"])
    for name, estimate_set in estimates.items():
        values = {
            "absolute_rmse": absolute_rmse(scenario, estimate_set),
            "absolute_mae": absolute_mae(scenario, estimate_set),
            "max_error": max_error(scenario, estimate_set),
            "centroid_error": centroid_error(scenario, estimate_set),
            "relative_rmse": relative_rmse(scenario, estimate_set),
            "orientation_error": orientation_error(scenario, estimate_set),
            "absolute_error_remaining": absolute_rmse(scenario, estimate_set),
            "relative_error_after_fusion": relative_rmse(scenario, estimate_set),
            "centroid_shift_after_fusion": centroid_error(scenario, estimate_set),
            "reference_available": 1.0 if reference_available else 0.0,
            "common_bias_observable": 1.0 if reference_available else 0.0,
        }
        if not reference_available and values["relative_rmse"] <= values["absolute_rmse"] * 0.1:
            if values["absolute_rmse"] > 1e-9:
                values["common_bias_failure_flag"] = 1.0
            else:
                values["common_bias_failure_flag"] = 0.0
        else:
            values["common_bias_failure_flag"] = 0.0
        if expected_common_bias_m is not None:
            estimated_bias = _estimated_bias_from_metadata(estimate_set)
            if estimated_bias is not None:
                values.update(bias_estimation_error(estimated_bias, expected_common_bias_m))
        if baseline_absolute is not None:
            values["absolute_rmse_improvement"] = _safe_improvement(
                baseline_absolute,
                values["absolute_rmse"],
            )
        if solver_trace is not None and solver_trace.iterations:
            first_cost = solver_trace.iterations[0].cost_total
            last_cost = solver_trace.iterations[-1].cost_total
            values["solver_cost_reduction"] = _safe_improvement(first_cost, last_cost)
        summaries[name] = MetricsSummary(method=name, values=values)
    return summaries


def _estimated_bias_from_metadata(estimate_set: EstimateSet) -> tuple[float, ...] | None:
    """Read estimated bias vector values from estimate metadata."""
    components = []
    component_index = 0
    while f"estimated_bias_m_{component_index}" in estimate_set.metadata:
        component = float(estimate_set.metadata[f"estimated_bias_m_{component_index}"])
        components.append(component)
        component_index += 1
    if not components:
        return None
    estimated_bias = tuple(components)
    return estimated_bias
