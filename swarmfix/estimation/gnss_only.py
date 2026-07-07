"""GNSS-only baseline estimator."""

from __future__ import annotations

from swarmfix.models.estimates import EstimateSet, PositionEstimate
from swarmfix.models.measurements import MeasurementSet


def estimate_gnss_only(measurements: MeasurementSet) -> EstimateSet:
    """Use GNSS measurements directly as estimated positions."""
    if not measurements.gnss:
        raise ValueError("GNSS-only estimate requires GNSS measurements")
    estimates = [
        PositionEstimate(agent_id=measurement.agent_id, position_m=measurement.position_m)
        for measurement in measurements.gnss
    ]
    estimate_set = EstimateSet(method="gnss_only", estimates=estimates)
    return estimate_set

