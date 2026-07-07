"""Absolute and relative localisation metrics."""

from __future__ import annotations

import itertools
import math

import numpy as np

from swarmfix.models.estimates import EstimateSet
from swarmfix.models.scenario import Scenario


def _matching_agent_ids(scenario: Scenario, estimate_set: EstimateSet) -> list[str]:
    """Return scenario agent IDs after checking estimates are complete."""
    scenario_ids = [agent.agent_id for agent in scenario.agents]
    estimate_ids = set(estimate.agent_id for estimate in estimate_set.estimates)
    if set(scenario_ids) != estimate_ids:
        raise ValueError("scenario and estimate agent IDs must match")
    return scenario_ids


def absolute_errors(scenario: Scenario, estimate_set: EstimateSet) -> list[float]:
    """Return per-agent absolute position errors."""
    agent_ids = _matching_agent_ids(scenario, estimate_set)
    errors = []
    for agent_id in agent_ids:
        truth = scenario.agent_position(agent_id)
        estimate = estimate_set.position_for(agent_id)
        errors.append(math.dist(truth, estimate))
    return errors


def absolute_rmse(scenario: Scenario, estimate_set: EstimateSet) -> float:
    """Return Earth-frame root mean squared error."""
    errors = absolute_errors(scenario, estimate_set)
    rmse = math.sqrt(sum(error ** 2 for error in errors) / len(errors))
    return rmse


def absolute_mae(scenario: Scenario, estimate_set: EstimateSet) -> float:
    """Return mean absolute Euclidean error."""
    errors = absolute_errors(scenario, estimate_set)
    mae = sum(errors) / len(errors)
    return mae


def max_error(scenario: Scenario, estimate_set: EstimateSet) -> float:
    """Return maximum absolute Euclidean error."""
    errors = absolute_errors(scenario, estimate_set)
    largest_error = max(errors)
    return largest_error


def centroid_error(scenario: Scenario, estimate_set: EstimateSet) -> float:
    """Return distance between truth and estimate centroids."""
    agent_ids = _matching_agent_ids(scenario, estimate_set)
    truth_points = np.asarray([scenario.agent_position(agent_id) for agent_id in agent_ids])
    estimate_points = np.asarray([estimate_set.position_for(agent_id) for agent_id in agent_ids])
    centroid_distance = float(np.linalg.norm(truth_points.mean(axis=0) - estimate_points.mean(axis=0)))
    return centroid_distance


def pairwise_distance_errors(scenario: Scenario, estimate_set: EstimateSet) -> list[float]:
    """Return pairwise distance errors, invariant to common translation."""
    agent_ids = _matching_agent_ids(scenario, estimate_set)
    errors = []
    for source_id, target_id in itertools.combinations(agent_ids, 2):
        truth_distance = scenario.true_distance(source_id, target_id)
        estimate_distance = math.dist(
            estimate_set.position_for(source_id),
            estimate_set.position_for(target_id),
        )
        errors.append(estimate_distance - truth_distance)
    return errors


def relative_rmse(scenario: Scenario, estimate_set: EstimateSet) -> float:
    """Return RMSE of pairwise formation distances."""
    errors = pairwise_distance_errors(scenario, estimate_set)
    rmse = math.sqrt(sum(error ** 2 for error in errors) / len(errors))
    return rmse


def orientation_error(scenario: Scenario, estimate_set: EstimateSet) -> float:
    """Return 2D orientation error in radians after removing translation."""
    if scenario.dimension != 2:
        raise ValueError("orientation_error supports 2D scenarios only")
    agent_ids = _matching_agent_ids(scenario, estimate_set)
    if len(agent_ids) < 2:
        raise ValueError("orientation_error requires at least two agents")
    truth_points = np.asarray([scenario.agent_position(agent_id) for agent_id in agent_ids])
    estimate_points = np.asarray([estimate_set.position_for(agent_id) for agent_id in agent_ids])
    truth_centered = truth_points - truth_points.mean(axis=0)
    estimate_centered = estimate_points - estimate_points.mean(axis=0)
    covariance = truth_centered.T @ estimate_centered
    u_matrix, _, vt_matrix = np.linalg.svd(covariance)
    rotation = vt_matrix.T @ u_matrix.T
    if np.linalg.det(rotation) < 0.0:
        vt_matrix[-1, :] *= -1.0
        rotation = vt_matrix.T @ u_matrix.T
    signed_angle = math.atan2(rotation[1, 0], rotation[0, 0])
    angle_error = abs(math.atan2(math.sin(signed_angle), math.cos(signed_angle)))
    return angle_error


def bias_estimation_error(estimated_bias_m: tuple[float, ...] | list[float],
                          expected_bias_m: tuple[float, ...] | list[float]) -> dict[str, float]:
    """Return vector and norm error for an estimated common translation bias."""
    if len(estimated_bias_m) != len(expected_bias_m):
        raise ValueError("estimated and expected bias dimension mismatch")
    estimated_bias = np.asarray(estimated_bias_m, dtype=float)
    expected_bias = np.asarray(expected_bias_m, dtype=float)
    bias_error = estimated_bias - expected_bias
    metric_values = {
        f"bias_error_{axis_name}": float(axis_error)
        for axis_name, axis_error in zip(("x", "y", "z"), bias_error)
    }
    metric_values["bias_error_norm"] = float(np.linalg.norm(bias_error))
    return metric_values
