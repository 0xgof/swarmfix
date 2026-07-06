"""GNSS measurement simulation."""

from __future__ import annotations

import numpy as np

from swarmfix.models.measurements import GnssMeasurement, MeasurementSet
from swarmfix.models.scenario import Scenario


def _validate_probability(name: str, probability: float) -> None:
    """Validate a probability parameter."""
    if not 0.0 <= probability <= 1.0:
        raise ValueError(f"{name} must be between 0 and 1")


def _spatially_correlated_noise(scenario: Scenario,
                                sigma_m: float,
                                correlation_length_m: float,
                                rng: np.random.Generator) -> np.ndarray:
    
    """Sample one correlated GNSS error vector per agent."""

    positions = np.asarray([agent.position_m for agent in scenario.agents], dtype=float)
    deltas = positions[:, None, :] - positions[None, :, :]
    distances = np.linalg.norm(deltas, axis=2)
    covariance = sigma_m ** 2 * np.exp(-distances / correlation_length_m)
    covariance = covariance + np.eye(len(scenario.agents)) * 1e-12

    correlated_components = [rng.multivariate_normal(np.zeros(len(scenario.agents)), covariance)
                             for _ in range(scenario.dimension)]
    
    correlated_noise = np.asarray(correlated_components).T
    return correlated_noise


def simulate_gnss(scenario: Scenario,
                  sigma_m: float,
                  common_bias_m: tuple[float, ...] | list[float],
                  independent_sigma_m: float,
                  seed: int | None = None,
                  outlier_probability: float = 0.0,
                  outlier_sigma_m: float = 0.0,
                  spatial_correlation_enabled: bool = False,
                  spatial_correlation_length_m: float | None = None,
                  spatial_correlation_sigma_m: float = 0.0) -> MeasurementSet:
    
    """Generate noisy GNSS measurements for every scenario agent."""

    if sigma_m <= 0.0:
        raise ValueError("sigma_m must be positive")
    if independent_sigma_m < 0.0:
        raise ValueError("independent_sigma_m must be non-negative")
    if len(common_bias_m) != scenario.dimension:
        raise ValueError("common_bias_m dimension mismatch")
    _validate_probability("outlier_probability", outlier_probability)
    if outlier_sigma_m < 0.0:
        raise ValueError("outlier_sigma_m must be non-negative")
    if outlier_probability > 0.0 and outlier_sigma_m <= 0.0:
        raise ValueError("outlier_sigma_m must be positive when outliers are enabled")
    if spatial_correlation_sigma_m < 0.0:
        raise ValueError("spatial_correlation_sigma_m must be non-negative")
    if spatial_correlation_enabled:
        if spatial_correlation_length_m is None:
            raise ValueError("spatial_correlation_length_m is required")
        if spatial_correlation_length_m <= 0.0:
            raise ValueError("spatial_correlation_length_m must be positive")
        
    rng = np.random.default_rng(seed)
    bias = np.asarray(common_bias_m, dtype=float)

    if spatial_correlation_enabled and spatial_correlation_sigma_m > 0.0:
        correlated_noise = _spatially_correlated_noise(scenario,
                                                       spatial_correlation_sigma_m,
                                                       spatial_correlation_length_m,
                                                       rng)
    else:
        correlated_noise = np.zeros((len(scenario.agents), scenario.dimension))
    measurements = []

    for agent_index, agent in enumerate(scenario.agents):
        truth = np.asarray(agent.position_m, dtype=float)
        independent_noise = rng.normal(0.0, independent_sigma_m, size=scenario.dimension)
        outlier_noise = np.zeros(scenario.dimension)
        if rng.random() < outlier_probability:
            outlier_noise = rng.normal(0.0, outlier_sigma_m, size=scenario.dimension)

        measured_position = tuple((
            truth
            + bias
            + correlated_noise[agent_index]
            + independent_noise
            + outlier_noise
        ).tolist())

        measurement = GnssMeasurement(agent_id=agent.agent_id,
                                      position_m=measured_position,
                                      sigma_m=sigma_m)
        
        measurements.append(measurement)
    measurement_set = MeasurementSet(gnss=measurements)
    return measurement_set
