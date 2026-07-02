"""Scenario plotting."""

from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt

from swarmfix.models.scenario import Scenario


def plot_scenario(scenario: Scenario, output_path: str | Path | None = None):
    """Plot true scenario positions and topology links."""
    figure, axes = plt.subplots()
    xs = [agent.position_m[0] for agent in scenario.agents]
    ys = [agent.position_m[1] for agent in scenario.agents]
    axes.scatter(xs, ys, label="truth")
    for agent in scenario.agents:
        axes.annotate(agent.agent_id, agent.position_m)
    if scenario.topology is not None:
        for edge in scenario.topology.edges:
            source = scenario.agent_position(edge.source_id)
            target = scenario.agent_position(edge.target_id)
            axes.plot([source[0], target[0]], [source[1], target[1]], color="0.8", linewidth=0.8)
    axes.set_aspect("equal", adjustable="box")
    axes.legend()
    if output_path is not None:
        figure.savefig(output_path, dpi=200, bbox_inches="tight")
    return figure
