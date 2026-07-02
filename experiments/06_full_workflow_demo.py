"""Run the full SwarmFix workflow demo."""

from helpers import build_experiment_parser, run_and_export


def main() -> int:
    """Run the full realistic demo and write metrics, JSON, and Python plots."""
    parser = build_experiment_parser(
        "Run the full SwarmFix workflow demo.",
        "outputs/06_full_workflow_demo",
    )
    args = parser.parse_args()
    run_and_export("configs/02_grid_10_agents.toml", args.output_dir, write_plots=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
