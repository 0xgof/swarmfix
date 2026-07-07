"""Mission-level translation bias correction."""

from __future__ import annotations

import numpy as np

from swarmfix.models.estimates import EstimateSet, PositionEstimate
from swarmfix.models.measurements import MeasurementSet


def apply_mission_bias_correction(estimate_set: EstimateSet,
                                  reference_measurements: MeasurementSet) -> EstimateSet:
    """Apply common translation correction estimated from reference measurements."""
    if not reference_measurements.references:
        raise ValueError("mission bias correction requires at least one reference")
    corrections = []
    for reference in reference_measurements.references:
        estimated_position = np.asarray(estimate_set.position_for(reference.agent_id), dtype=float)
        known_position = np.asarray(reference.position_m, dtype=float)
        corrections.append(estimated_position - known_position)
    correction = np.mean(np.asarray(corrections), axis=0)
    corrected_estimates = []
    for estimate in estimate_set.estimates:
        position = np.asarray(estimate.position_m, dtype=float)
        corrected_position = tuple((position - correction).tolist())
        corrected_estimates.append(
            PositionEstimate(agent_id=estimate.agent_id, position_m=corrected_position)
        )
    metadata = {
        f"estimated_bias_m_{component_index}": float(component)
        for component_index, component in enumerate(correction)
    }
    corrected_set = EstimateSet(
        method="mission_bias_corrected",
        estimates=corrected_estimates,
        metadata=metadata,
    )
    return corrected_set
