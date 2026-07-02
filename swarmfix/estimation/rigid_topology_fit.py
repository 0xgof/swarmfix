"""Rigid 2D topology alignment estimator."""

from __future__ import annotations

import numpy as np

from swarmfix.models.estimates import EstimateSet, PositionEstimate
from swarmfix.models.measurements import MeasurementSet
from swarmfix.models.scenario import Scenario


def estimate_rigid_topology_fit(scenario: Scenario,
                                measurements: MeasurementSet) -> EstimateSet:
    """Align true local topology to GNSS measurements with a 2D rigid transform."""
    if scenario.dimension != 2:
        raise ValueError("rigid topology fit currently supports 2D only")
    gnss_by_id = {measurement.agent_id: measurement.position_m for measurement in measurements.gnss}
    agent_ids = [agent.agent_id for agent in scenario.agents]
    if set(agent_ids) != set(gnss_by_id):
        raise ValueError("scenario and GNSS measurement agent IDs must match")

    local_points = np.asarray([scenario.agent_position(agent_id) for agent_id in agent_ids])
    measured_points = np.asarray([gnss_by_id[agent_id] for agent_id in agent_ids])
    local_centroid = local_points.mean(axis=0)
    measured_centroid = measured_points.mean(axis=0)
    local_centered = local_points - local_centroid
    measured_centered = measured_points - measured_centroid
    covariance = local_centered.T @ measured_centered
    u_matrix, _, vt_matrix = np.linalg.svd(covariance)
    rotation = vt_matrix.T @ u_matrix.T
    if np.linalg.det(rotation) < 0.0:
        vt_matrix[-1, :] *= -1.0
        rotation = vt_matrix.T @ u_matrix.T
    aligned_points = (local_centered @ rotation.T) + measured_centroid
    estimates = [
        PositionEstimate(agent_id=agent_id, position_m=tuple(aligned_points[index].tolist()))
        for index, agent_id in enumerate(agent_ids)
    ]
    estimate_set = EstimateSet(method="rigid_topology_fit", estimates=estimates)
    return estimate_set

