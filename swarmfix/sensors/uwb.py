"""UWB range measurement simulation."""

from __future__ import annotations

import numpy as np

from swarmfix.models.measurements import MeasurementSet, UwbRangeMeasurement
from swarmfix.models.scenario import Scenario, TopologyEdge
from swarmfix.scenarios.topologies import build_full_pairwise_topology, build_neighbour_topology


def _measurement_edges(scenario: Scenario, max_range_m: float | None) -> list[TopologyEdge]:
    """Return topology edges to measure."""
    if scenario.topology is not None and scenario.topology.edges:
        return scenario.topology.edges
    if max_range_m is not None:
        return build_neighbour_topology(scenario, max_range_m).edges
    return build_full_pairwise_topology(scenario).edges


def simulate_uwb(scenario: Scenario,
                 sigma_m: float,
                 seed: int | None = None,
                 max_range_m: float | None = None,
                 missing_link_probability: float = 0.0,
                 nlos_probability: float = 0.0,
                 nlos_positive_bias_m: float = 0.0) -> MeasurementSet:
    """Generate UWB range measurements from topology or max-range links."""
    if sigma_m <= 0.0:
        raise ValueError("sigma_m must be positive")
    if not 0.0 <= missing_link_probability <= 1.0:
        raise ValueError("missing_link_probability must be between 0 and 1")
    if not 0.0 <= nlos_probability <= 1.0:
        raise ValueError("nlos_probability must be between 0 and 1")
    if nlos_positive_bias_m < 0.0:
        raise ValueError("nlos_positive_bias_m must be non-negative")
    rng = np.random.default_rng(seed)
    measurements = []
    for edge in _measurement_edges(scenario, max_range_m):
        if rng.random() < missing_link_probability:
            continue
        true_distance_m = scenario.true_distance(edge.source_id, edge.target_id)
        noise_m = rng.normal(0.0, sigma_m)
        nlos_bias_m = nlos_positive_bias_m if rng.random() < nlos_probability else 0.0
        measured_distance_m = max(true_distance_m + noise_m + nlos_bias_m, 1e-9)
        measurement = UwbRangeMeasurement(
            source_id=edge.source_id,
            target_id=edge.target_id,
            distance_m=float(measured_distance_m),
            sigma_m=sigma_m,
            true_distance_m=true_distance_m,
        )
        measurements.append(measurement)
    measurement_set = MeasurementSet(uwb=measurements)
    return measurement_set
