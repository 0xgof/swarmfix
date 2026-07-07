"""Estimate overlay plotting."""

from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.collections import LineCollection
from matplotlib.lines import Line2D
from matplotlib.patches import Circle

from swarmfix.models.results import PipelineResult


def _scatter_positions(axes, positions, label: str) -> None:
    """Scatter position tuples on an axes."""
    xs = [position[0] for position in positions]
    ys = [position[1] for position in positions]
    axes.scatter(xs, ys, label=label)


def _draw_estimate_points(axes, result: PipelineResult) -> None:
    """Draw truth, GNSS, and estimate point clouds on an axes."""
    truth_positions = [agent.position_m for agent in result.scenario.agents]
    _scatter_positions(axes, truth_positions, "truth")
    axes.scatter(
        [position[0] for position in truth_positions],
        [position[1] for position in truth_positions],
        marker="x",
        color="black",
        linewidths=1.4,
        label="truth x",
    )
    _draw_gnss_uncertainty_areas(axes, result)
    _scatter_positions(axes, [measurement.position_m for measurement in result.measurements.gnss], "gnss")
    for name, estimate_set in result.estimates.items():
        _scatter_positions(axes, [estimate.position_m for estimate in estimate_set.estimates], name)


def _draw_gnss_uncertainty_areas(axes, result: PipelineResult) -> None:
    """Draw one shaded one-sigma uncertainty circle per GNSS measurement."""
    for measurement_index, measurement in enumerate(result.measurements.gnss):
        if len(measurement.position_m) != 2:
            continue
        label = "GNSS σ" if measurement_index == 0 else None
        uncertainty_circle = Circle(
            xy=(measurement.position_m[0], measurement.position_m[1]),
            radius=measurement.sigma_m,
            facecolor="tab:orange",
            edgecolor="tab:orange",
            alpha=0.10,
            label=label,
        )
        axes.add_patch(uncertainty_circle)


def _draw_uwb_links(axes, result: PipelineResult, estimate_name: str) -> None:
    """Draw UWB constraints as uncertainty bands and residual-coloured edges."""
    if estimate_name not in result.estimates:
        raise ValueError(f"unknown estimate: {estimate_name}")
    estimate_set = result.estimates[estimate_name]
    segments = []
    residual_scores = []
    sigma_values = []
    for measurement in result.measurements.uwb:
        source = estimate_set.position_for(measurement.source_id)
        target = estimate_set.position_for(measurement.target_id)
        source_point = np.asarray(source[:2], dtype=float)
        target_point = np.asarray(target[:2], dtype=float)
        edge_vector = target_point - source_point
        fused_distance = float(np.linalg.norm(edge_vector))
        if fused_distance <= 1e-12:
            continue
        weighted_residual = abs(fused_distance - measurement.distance_m) / measurement.sigma_m
        segments.append([(source_point[0], source_point[1]), (target_point[0], target_point[1])])
        residual_scores.append(min(weighted_residual, 3.0))
        sigma_values.append(measurement.sigma_m)
    if not segments:
        return
    band_collection = LineCollection(
        segments,
        colors="#64748b",
        linewidths=[max(7.0, sigma * 70.0) for sigma in sigma_values],
        alpha=0.24,
        zorder=0,
    )
    edge_collection = LineCollection(
        segments,
        cmap="RdYlGn_r",
        linewidths=1.8,
        alpha=0.9,
        zorder=0.2,
    )
    edge_collection.set_array(np.asarray(residual_scores, dtype=float))
    edge_collection.set_clim(0.0, 3.0)
    axes.add_collection(band_collection)
    axes.add_collection(edge_collection)


def _place_bottom_legend(axes, handles=None, labels=None) -> None:
    """Place a short, wide legend below the plot area."""
    if handles is None or labels is None:
        handles, labels = axes.get_legend_handles_labels()
    axes.figure.legend(
        handles,
        labels,
        loc="outside lower center",
        ncols=4,
        frameon=True,
        handlelength=1.4,
        handletextpad=0.5,
        columnspacing=1.0,
        fontsize=9,
    )


def plot_estimates(result: PipelineResult, output_path: str | Path | None = None):
    """Plot truth, GNSS measurements, and available estimates."""
    figure, axes = plt.subplots(layout="constrained")
    _draw_estimate_points(axes, result)
    axes.set_aspect("equal", adjustable="box")
    _place_bottom_legend(axes)
    if output_path is not None:
        figure.savefig(output_path, dpi=200, bbox_inches="tight")
    return figure


def plot_estimates_with_uwb_links(result: PipelineResult,
                                  output_path: str | Path | None = None,
                                  estimate_name: str = "fused"):
    """Plot estimates with measured UWB triangulation links overlaid."""
    figure, axes = plt.subplots(layout="constrained")
    _draw_estimate_points(axes, result)
    _draw_uwb_links(axes, result, estimate_name)
    axes.set_aspect("equal", adjustable="box")
    handles, labels = axes.get_legend_handles_labels()
    handles.append(Line2D([0], [0], color="0.25", linewidth=1.4))
    labels.append("UWB")
    _place_bottom_legend(axes, handles, labels)
    if output_path is not None:
        figure.savefig(output_path, dpi=200, bbox_inches="tight")
    return figure
