"""Scenario and topology records for localisation experiments."""

from __future__ import annotations

from math import dist

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class AgentState(BaseModel):
    """Ground-truth state for one agent in a scenario."""

    model_config = ConfigDict(frozen=True)

    agent_id: str
    position_m: tuple[float, ...]

    @field_validator("agent_id")
    @classmethod
    def agent_id_must_not_be_empty(cls, agent_id: str) -> str:
        """Reject blank agent identifiers."""
        if not agent_id:
            raise ValueError("agent_id must not be empty")
        return agent_id


class TopologyEdge(BaseModel):
    """Known or intended distance constraint between two agents."""

    model_config = ConfigDict(frozen=True)

    source_id: str
    target_id: str
    distance_m: float

    @model_validator(mode="after")
    def validate_edge(self) -> TopologyEdge:
        """Reject invalid topology edges."""
        if self.source_id == self.target_id:
            raise ValueError("topology edge endpoints must differ")
        if self.distance_m <= 0.0:
            raise ValueError("topology edge distance_m must be positive")
        return self


class TopologyGraph(BaseModel):
    """Collection of topology constraints for a scenario."""

    edges: list[TopologyEdge] = Field(default_factory=list)


class Scenario(BaseModel):
    """True scenario state and optional topology graph."""

    name: str
    dimension: int
    agents: list[AgentState]
    topology: TopologyGraph | None = None
    units: str = "meters"

    @model_validator(mode="after")
    def validate_scenario(self) -> Scenario:
        """Validate agent uniqueness, dimensions, and topology references."""
        agent_ids = [agent.agent_id for agent in self.agents]
        if len(agent_ids) != len(set(agent_ids)):
            raise ValueError("agent IDs must be unique")
        if self.dimension not in (2, 3):
            raise ValueError("scenario dimension must be 2 or 3")
        for agent in self.agents:
            if len(agent.position_m) != self.dimension:
                raise ValueError("agent position dimension mismatch")
        if self.topology is not None:
            valid_ids = set(agent_ids)
            for edge in self.topology.edges:
                if edge.source_id not in valid_ids or edge.target_id not in valid_ids:
                    raise ValueError("topology edge references unknown agent")
        return self

    def agent_position(self, agent_id: str) -> tuple[float, ...]:
        """Return an agent position by id."""
        for agent in self.agents:
            if agent.agent_id == agent_id:
                return agent.position_m
        raise KeyError(f"unknown agent_id: {agent_id}")

    def true_distance(self, source_id: str, target_id: str) -> float:
        """Return the true distance between two agents."""
        source_position = self.agent_position(source_id)
        target_position = self.agent_position(target_id)
        true_distance_m = dist(source_position, target_position)
        return true_distance_m

