"""Error vector plotting."""

from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt

from swarmfix.models.results import PipelineResult


def plot_error_vectors(result: PipelineResult,
                       estimate_name: str = "fused",
                       output_path: str | Path | None = None):
    """Plot vectors from truth to an estimate set."""
    if estimate_name not in result.estimates:
        raise ValueError(f"unknown estimate: {estimate_name}")
    estimate_set = result.estimates[estimate_name]
    figure, axes = plt.subplots()
    for agent in result.scenario.agents:
        estimate = estimate_set.position_for(agent.agent_id)
        dx = estimate[0] - agent.position_m[0]
        dy = estimate[1] - agent.position_m[1]
        axes.arrow(agent.position_m[0], agent.position_m[1], dx, dy, length_includes_head=True)
        axes.scatter([agent.position_m[0]], [agent.position_m[1]], color="black")
    axes.set_aspect("equal", adjustable="box")
    if output_path is not None:
        figure.savefig(output_path, dpi=200, bbox_inches="tight")
    return figure
