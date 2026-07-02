"""Config-facing scenario construction."""

from __future__ import annotations

from swarmfix.models.scenario import Scenario
from swarmfix.scenarios.formations import make_grid_formation, make_square_formation
from swarmfix.scenarios.topologies import build_full_pairwise_topology, build_neighbour_topology


def build_scenario(config) -> Scenario:
    """Build a scenario and topology graph from a validated config object."""
    scenario_config = config.scenario
    if scenario_config.dimension != 2:
        raise ValueError("MVP only supports static 2D scenarios")
    if scenario_config.formation == "square":
        scenario = make_square_formation(scenario_config.spacing_m, name=scenario_config.name)
    elif scenario_config.formation == "grid":
        scenario = make_grid_formation(
            scenario_config.num_agents,
            scenario_config.spacing_m,
            name=scenario_config.name,
        )
    else:
        raise ValueError(f"unsupported formation: {scenario_config.formation}")

    topology_config = getattr(config, "topology", None)
    if topology_config is None or topology_config.mode == "full_pairwise":
        topology = build_full_pairwise_topology(scenario)
    elif topology_config.mode == "neighbour":
        topology = build_neighbour_topology(scenario, topology_config.max_distance_m)
    else:
        raise ValueError(f"unsupported topology mode: {topology_config.mode}")

    scenario_with_topology = scenario.model_copy(update={"topology": topology})
    return scenario_with_topology

