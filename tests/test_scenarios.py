"""Tests for scenario formation and topology modules."""

import math

import pytest
from pydantic import BaseModel


def test_square_formation_has_expected_geometry_and_agent_ids() -> None:
    from swarmfix.scenarios.formations import make_square_formation

    square = make_square_formation(spacing_m=5.0)
    positions = {agent.agent_id: agent.position_m for agent in square.agents}

    assert positions == {
        "robot_0": (0.0, 0.0),
        "robot_1": (5.0, 0.0),
        "robot_2": (0.0, 5.0),
        "robot_3": (5.0, 5.0),
    }
    assert math.dist(positions["robot_0"], positions["robot_3"]) == pytest.approx(5.0 * math.sqrt(2.0))

    with pytest.raises(ValueError):
        make_square_formation(spacing_m=0.0)


def test_grid_formation_is_deterministic_for_non_square_agent_counts() -> None:
    from swarmfix.scenarios.formations import make_grid_formation

    grid = make_grid_formation(num_agents=10, spacing_m=5.0)

    assert [agent.agent_id for agent in grid.agents][:4] == [
        "robot_0",
        "robot_1",
        "robot_2",
        "robot_3",
    ]
    assert grid.agents[1].position_m == (5.0, 0.0)
    assert grid.agents[4].position_m == (0.0, 5.0)

    with pytest.raises(ValueError):
        make_grid_formation(num_agents=0, spacing_m=5.0)

    with pytest.raises(ValueError):
        make_grid_formation(num_agents=4, spacing_m=0.0)


def test_topology_builders_create_pairwise_and_neighbour_edges() -> None:
    from swarmfix.scenarios.formations import make_square_formation
    from swarmfix.scenarios.topologies import build_full_pairwise_topology, build_neighbour_topology

    square = make_square_formation(spacing_m=5.0)
    full_topology = build_full_pairwise_topology(square)
    neighbour_topology = build_neighbour_topology(square, max_distance_m=5.1)

    assert len(full_topology.edges) == 6
    assert len(neighbour_topology.edges) == 4
    assert all(edge.distance_m <= 5.1 for edge in neighbour_topology.edges)

    with pytest.raises(ValueError):
        build_neighbour_topology(square, max_distance_m=0.0)


def test_scenario_builder_routes_valid_configs_and_rejects_unsupported_values() -> None:
    from swarmfix.scenarios.build_scenario import build_scenario

    class ScenarioConfig(BaseModel):
        name: str = "square"
        dimension: int = 2
        formation: str = "square"
        num_agents: int = 4
        spacing_m: float = 5.0

    class TopologyConfig(BaseModel):
        mode: str = "full_pairwise"
        max_distance_m: float | None = None

    class Config(BaseModel):
        scenario: ScenarioConfig
        topology: TopologyConfig = TopologyConfig()

    scenario = build_scenario(Config(scenario=ScenarioConfig()))
    neighbour_scenario = build_scenario(
        Config(
            scenario=ScenarioConfig(),
            topology=TopologyConfig(mode="neighbour", max_distance_m=5.1),
        )
    )
    assert scenario.topology is not None
    assert len(scenario.topology.edges) == 6
    assert len(neighbour_scenario.topology.edges) == 4

    with pytest.raises(ValueError, match="2D"):
        build_scenario(Config(scenario=ScenarioConfig(dimension=3)))

    with pytest.raises(ValueError, match="unsupported formation"):
        build_scenario(Config(scenario=ScenarioConfig(formation="spiral")))

    with pytest.raises(ValueError, match="unsupported topology"):
        build_scenario(
            Config(
                scenario=ScenarioConfig(),
                topology=TopologyConfig(mode="unsupported"),
            )
        )


def test_trajectories_module_is_importable_placeholder() -> None:
    import swarmfix.scenarios.trajectories as trajectories

    assert trajectories.__doc__
