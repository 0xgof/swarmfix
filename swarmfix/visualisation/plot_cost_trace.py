"""Solver cost trace plotting."""

from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt

from swarmfix.models.residuals import SolverTrace


def plot_cost_trace(solver_trace: SolverTrace | None, output_path: str | Path | None = None):
    """Plot total and per-term solver costs from a real trace."""
    figure, axes = plt.subplots()
    if solver_trace is not None and solver_trace.iterations:
        xs = [trace.iteration for trace in solver_trace.iterations]
        axes.plot(xs, [trace.cost_total for trace in solver_trace.iterations], label="total")
        axes.plot(xs, [trace.cost_gnss for trace in solver_trace.iterations], label="gnss")
        axes.plot(xs, [trace.cost_uwb for trace in solver_trace.iterations], label="uwb")
        axes.plot(xs, [trace.cost_reference for trace in solver_trace.iterations], label="reference")
        axes.legend()
    axes.set_xlabel("trace index")
    axes.set_ylabel("weighted cost")
    if output_path is not None:
        figure.savefig(output_path, dpi=200, bbox_inches="tight")
    return figure
