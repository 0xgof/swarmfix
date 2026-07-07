"""Topology graph builders for known formation constraints."""

from __future__ import annotations

from swarmfix.models.scenario import Scenario, TopologyEdge, TopologyGraph


def build_full_pairwise_topology(scenario: Scenario) -> TopologyGraph:
    """Build a full pairwise topology graph from true scenario positions."""
    edges = []
    for source_index, source_agent in enumerate(scenario.agents):
        for target_agent in scenario.agents[source_index + 1:]:
            distance_m = scenario.true_distance(source_agent.agent_id, target_agent.agent_id)
            edge = TopologyEdge(
                source_id=source_agent.agent_id,
                target_id=target_agent.agent_id,
                distance_m=distance_m,
            )
            edges.append(edge)
    topology = TopologyGraph(edges=edges)
    return topology


def build_neighbour_topology(scenario: Scenario, max_distance_m: float) -> TopologyGraph:
    """Build topology edges whose true distances are within a maximum range."""
    if max_distance_m <= 0.0:
        raise ValueError("max_distance_m must be positive")
    full_topology = build_full_pairwise_topology(scenario)
    edges = [edge for edge in full_topology.edges if edge.distance_m <= max_distance_m]
    topology = TopologyGraph(edges=edges)
    return topology

