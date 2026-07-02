"""Run the UWB/GNSS fusion experiment."""

from helpers import build_experiment_parser, run_and_export


def main() -> int:
    """Run the grid fusion config and export solver trace data."""
    parser = build_experiment_parser(
        "Run the UWB/GNSS fusion SwarmFix experiment.",
        "outputs/03_uwb_gnss_fusion",
    )
    args = parser.parse_args()
    run_and_export("configs/02_grid_10_agents.toml", args.output_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

