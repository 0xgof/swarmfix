"""Mission reference measurement simulation."""

from __future__ import annotations

from swarmfix.models.measurements import MeasurementSet, ReferenceMeasurement
from swarmfix.models.scenario import Scenario


def simulate_reference(scenario: Scenario,
                       enabled: bool,
                       reference_type: str,
                       agent_id: str | None,
                       position_m: tuple[float, ...] | list[float] | None,
                       sigma_m: float | None = None) -> MeasurementSet:
    """Generate optional mission reference measurements."""
    if not enabled:
        return MeasurementSet()
    if reference_type != "known_agent_position":
        raise ValueError(f"unsupported reference type: {reference_type}")
    if agent_id is None or position_m is None:
        raise ValueError("reference agent_id and position_m are required")
    scenario.agent_position(agent_id)
    if len(position_m) != scenario.dimension:
        raise ValueError("reference position dimension mismatch")
    measurement = ReferenceMeasurement(
        agent_id=agent_id,
        position_m=tuple(float(value) for value in position_m),
        sigma_m=sigma_m,
    )
    measurement_set = MeasurementSet(references=[measurement])
    return measurement_set
