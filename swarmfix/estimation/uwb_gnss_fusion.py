"""Weighted least-squares GNSS/UWB fusion."""

from __future__ import annotations

import math

import numpy as np
from scipy.optimize import least_squares

from swarmfix.estimation.gnss_only import estimate_gnss_only
from swarmfix.models.estimates import EstimateSet, PositionEstimate
from swarmfix.models.measurements import MeasurementSet
from swarmfix.models.residuals import (
    GnssResidual,
    SolverIterationTrace,
    SolverTrace,
    UwbResidual,
)


def _agent_ids(measurements: MeasurementSet) -> list[str]:
    """Return deterministic agent IDs from GNSS measurements."""
    agent_ids = [measurement.agent_id for measurement in measurements.gnss]
    if len(agent_ids) != len(set(agent_ids)):
        raise ValueError("duplicate GNSS measurement agent IDs")
    return agent_ids


def _positions_from_vector(vector: np.ndarray,
                           agent_ids: list[str],
                           dimension: int) -> dict[str, tuple[float, ...]]:
    """Convert a flat solver vector into a position map."""
    positions = {}
    for index, agent_id in enumerate(agent_ids):
        start = index * dimension
        stop = start + dimension
        positions[agent_id] = tuple(vector[start:stop].tolist())
    return positions


def build_weighted_residuals(vector: np.ndarray,
                             agent_ids: list[str],
                             dimension: int,
                             measurements: MeasurementSet,
                             iteration: int = 0) -> tuple[np.ndarray, SolverIterationTrace]:
    """Build weighted residual vector and matching trace records."""
    positions = _positions_from_vector(vector, agent_ids, dimension)
    residual_values: list[float] = []
    gnss_residuals = []
    uwb_residuals = []
    cost_gnss = 0.0
    cost_uwb = 0.0

    for measurement in measurements.gnss:
        estimate = np.asarray(positions[measurement.agent_id], dtype=float)
        gnss_position = np.asarray(measurement.position_m, dtype=float)
        residual_vector = estimate - gnss_position
        weighted_vector = residual_vector / measurement.sigma_m
        residual_values.extend(weighted_vector.tolist())
        weighted_sq = float(np.dot(weighted_vector, weighted_vector))
        cost_gnss += weighted_sq
        residual = GnssResidual(
            agent_id=measurement.agent_id,
            vector=tuple(residual_vector.tolist()),
            norm=float(np.linalg.norm(residual_vector)),
            weighted_sq=weighted_sq,
        )
        gnss_residuals.append(residual)

    for measurement in measurements.uwb:
        source = np.asarray(positions[measurement.source_id], dtype=float)
        target = np.asarray(positions[measurement.target_id], dtype=float)
        current_distance = float(np.linalg.norm(source - target))
        residual_m = current_distance - measurement.distance_m
        weighted_residual = residual_m / measurement.sigma_m
        residual_values.append(weighted_residual)
        weighted_sq = float(weighted_residual ** 2)
        cost_uwb += weighted_sq
        residual = UwbResidual(
            source_id=measurement.source_id,
            target_id=measurement.target_id,
            residual_m=float(residual_m),
            weighted_sq=weighted_sq,
        )
        uwb_residuals.append(residual)

    cost_total = cost_gnss + cost_uwb
    trace = SolverIterationTrace(
        iteration=iteration,
        positions=positions,
        cost_total=cost_total,
        cost_gnss=cost_gnss,
        cost_uwb=cost_uwb,
        gnss_residuals=gnss_residuals,
        uwb_residuals=uwb_residuals,
    )
    residual_array = np.asarray(residual_values, dtype=float)
    return residual_array, trace


def estimate_uwb_gnss_fusion(measurements: MeasurementSet,
                             uwb_measurements: MeasurementSet | None = None,
                             max_iterations: int = 100,
                             robust_loss: str = "linear") -> tuple[EstimateSet, SolverTrace]:
    """Fuse GNSS and UWB measurements with weighted least squares."""
    combined_measurements = MeasurementSet(
        gnss=measurements.gnss,
        uwb=uwb_measurements.uwb if uwb_measurements is not None else measurements.uwb,
        references=measurements.references,
    )
    if not combined_measurements.gnss:
        raise ValueError("fusion requires GNSS measurements")
    agent_ids = _agent_ids(combined_measurements)
    dimension = len(combined_measurements.gnss[0].position_m)
    gnss_initial = estimate_gnss_only(combined_measurements)
    initial_vector = np.asarray(
        [coordinate for agent_id in agent_ids for coordinate in gnss_initial.position_for(agent_id)],
        dtype=float,
    )
    trace_iterations: list[SolverIterationTrace] = []

    def residual_function(vector: np.ndarray) -> np.ndarray:
        residuals, trace = build_weighted_residuals(
            vector,
            agent_ids,
            dimension,
            combined_measurements,
            iteration=len(trace_iterations),
        )
        if not trace_iterations or not math.isclose(trace.cost_total, trace_iterations[-1].cost_total):
            trace_iterations.append(trace)
        return residuals

    solution = least_squares(
        residual_function,
        initial_vector,
        loss=robust_loss,
        max_nfev=max_iterations,
    )
    final_positions = _positions_from_vector(solution.x, agent_ids, dimension)
    estimates = [
        PositionEstimate(agent_id=agent_id, position_m=final_positions[agent_id])
        for agent_id in agent_ids
    ]
    estimate_set = EstimateSet(method="uwb_gnss_fusion", estimates=estimates)
    solver_trace = SolverTrace(trace_type="residual_evaluation", iterations=trace_iterations)
    return estimate_set, solver_trace

