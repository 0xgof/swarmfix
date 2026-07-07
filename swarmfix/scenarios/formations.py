"""Static formation builders."""

from __future__ import annotations

import math

from swarmfix.models.scenario import AgentState, Scenario


def make_square_formation(spacing_m: float, name: str = "square_static") -> Scenario:
    """Create four agents arranged as a 2D square."""
    if spacing_m <= 0.0:
        raise ValueError("spacing_m must be positive")
    agents = [
        AgentState(agent_id="robot_0", position_m=(0.0, 0.0)),
        AgentState(agent_id="robot_1", position_m=(spacing_m, 0.0)),
        AgentState(agent_id="robot_2", position_m=(0.0, spacing_m)),
        AgentState(agent_id="robot_3", position_m=(spacing_m, spacing_m)),
    ]
    scenario = Scenario(name=name, dimension=2, agents=agents)
    return scenario


def make_grid_formation(num_agents: int,
                        spacing_m: float,
                        name: str = "grid_static") -> Scenario:
    """Create a deterministic row-major 2D grid formation."""
    if num_agents <= 0:
        raise ValueError("num_agents must be positive")
    if spacing_m <= 0.0:
        raise ValueError("spacing_m must be positive")
    columns = math.ceil(math.sqrt(num_agents))
    agents = []
    for index in range(num_agents):
        row = index // columns
        column = index % columns
        position_m = (column * spacing_m, row * spacing_m)
        agents.append(AgentState(agent_id=f"robot_{index}", position_m=position_m))
    scenario = Scenario(name=name, dimension=2, agents=agents)
    return scenario

