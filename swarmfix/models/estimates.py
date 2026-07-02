"""Position estimate records."""

from __future__ import annotations

from pydantic import BaseModel, Field


class PositionEstimate(BaseModel):
    """Estimated position for one agent."""

    agent_id: str
    position_m: tuple[float, ...]


class EstimateSet(BaseModel):
    """Named set of position estimates."""

    method: str
    estimates: list[PositionEstimate]
    metadata: dict[str, str | float | int | bool] = Field(default_factory=dict)

    def position_for(self, agent_id: str) -> tuple[float, ...]:
        """Return an estimated position by agent id."""
        for estimate in self.estimates:
            if estimate.agent_id == agent_id:
                return estimate.position_m
        raise KeyError(f"unknown estimate agent_id: {agent_id}")

    def as_position_map(self) -> dict[str, tuple[float, ...]]:
        """Return estimates keyed by agent id."""
        estimate_map = {estimate.agent_id: estimate.position_m for estimate in self.estimates}
        return estimate_map

