"""Sweep UWB link density and report fusion performance."""

from __future__ import annotations

import csv
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import matplotlib.pyplot as plt
import numpy as np

from helpers import build_experiment_parser
from swarmfix.estimation.gnss_only import estimate_gnss_only
from swarmfix.estimation.uwb_gnss_fusion import estimate_uwb_gnss_fusion
from swarmfix.evaluation.metrics import absolute_rmse, relative_rmse
from swarmfix.io.config import load_config
from swarmfix.models.measurements import MeasurementSet
from swarmfix.scenarios.build_scenario import build_scenario
from swarmfix.sensors.gnss import simulate_gnss
from swarmfix.sensors.uwb import simulate_uwb


def link_count_schedule(total_links: int, steps: int = 8) -> list[int]:
    """Return deterministic link counts from zero to all available links."""
    if total_links <= 0:
        return [0]
    raw_counts = np.linspace(0, total_links, num=min(steps, total_links + 1))
    link_counts = sorted({int(round(count)) for count in raw_counts})
    if link_counts[0] != 0:
        link_counts.insert(0, 0)
    if link_counts[-1] != total_links:
        link_counts.append(total_links)
    return link_counts


def run_sweep(config_path: str | Path) -> list[dict[str, float]]:
    """Run a deterministic UWB link-count sweep for one config."""
    config = load_config(config_path)
    full_config = config.model_copy(
        update={
            "topology": config.topology.model_copy(update={"mode": "full_pairwise"}),
            "uwb": config.uwb.model_copy(update={"max_range_m": None}),
        }
    )
    scenario = build_scenario(full_config)
    gnss_measurements = simulate_gnss(
        scenario,
        sigma_m=full_config.gnss.sigma_m,
        common_bias_m=full_config.gnss.common_bias_m,
        independent_sigma_m=full_config.gnss.independent_sigma_m,
        seed=full_config.seed,
        outlier_probability=full_config.gnss.outlier_probability,
        outlier_sigma_m=full_config.gnss.outlier_sigma_m,
        spatial_correlation_enabled=full_config.gnss.spatial_correlation_enabled,
        spatial_correlation_length_m=full_config.gnss.spatial_correlation_length_m,
        spatial_correlation_sigma_m=full_config.gnss.spatial_correlation_sigma_m,
    )
    all_uwb_measurements = simulate_uwb(
        scenario,
        sigma_m=full_config.uwb.sigma_m,
        seed=full_config.seed,
        max_range_m=None,
        missing_link_probability=0.0,
        nlos_probability=0.0,
        nlos_positive_bias_m=0.0,
    ).uwb
    rng = np.random.default_rng(full_config.seed)
    shuffled_indices = rng.permutation(len(all_uwb_measurements)).tolist()
    shuffled_uwb = [all_uwb_measurements[index] for index in shuffled_indices]
    gnss_only = estimate_gnss_only(gnss_measurements)

    rows = []
    for link_count in link_count_schedule(len(shuffled_uwb)):
        selected_uwb = MeasurementSet(uwb=shuffled_uwb[:link_count])
        fused, _ = estimate_uwb_gnss_fusion(
            gnss_measurements,
            selected_uwb,
            max_iterations=full_config.estimation.max_iterations,
            robust_loss=full_config.estimation.robust_loss,
        )
        rows.append({
            "uwb_link_count": link_count,
            "absolute_rmse": absolute_rmse(scenario, fused),
            "relative_rmse": relative_rmse(scenario, fused),
            "gnss_absolute_rmse": absolute_rmse(scenario, gnss_only),
            "gnss_relative_rmse": relative_rmse(scenario, gnss_only),
        })
    return rows


def write_metrics_csv(rows: list[dict[str, float]], output_path: Path) -> None:
    """Write sweep rows to CSV."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "uwb_link_count",
        "absolute_rmse",
        "relative_rmse",
        "gnss_absolute_rmse",
        "gnss_relative_rmse",
    ]
    with output_path.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_sweep_plot(rows: list[dict[str, float]], output_path: Path) -> None:
    """Write a link-density RMSE plot."""
    link_counts = [row["uwb_link_count"] for row in rows]
    absolute_values = [row["absolute_rmse"] for row in rows]
    relative_values = [row["relative_rmse"] for row in rows]
    figure, axes = plt.subplots(layout="constrained")
    axes.plot(link_counts, absolute_values, marker="o", label="absolute RMSE")
    axes.plot(link_counts, relative_values, marker="o", label="relative RMSE")
    axes.set_xlabel("UWB link count")
    axes.set_ylabel("RMSE (m)")
    axes.legend()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output_path, dpi=200, bbox_inches="tight")
    plt.close(figure)


def main() -> int:
    """Run the UWB link-density sweep experiment."""
    parser = build_experiment_parser(
        "Run a UWB link-density performance sweep.",
        "outputs/09_uwb_link_density_sweep",
    )
    args = parser.parse_args()
    output_dir = Path(args.output_dir)
    rows = run_sweep("configs/02_grid_10_agents.toml")
    write_metrics_csv(rows, output_dir / "link_density_metrics.csv")
    write_sweep_plot(rows, output_dir / "link_density_rmse.png")
    print("Sweep complete")
    for row in rows:
        print(
            "links={links:.0f} absolute_rmse={absolute:.6f} relative_rmse={relative:.6f}".format(
                links=row["uwb_link_count"],
                absolute=row["absolute_rmse"],
                relative=row["relative_rmse"],
            )
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
