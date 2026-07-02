"""Run the mission-reference bias correction experiment."""

from helpers import build_experiment_parser, run_and_export


def main() -> int:
    """Run the mission-reference config and export correction results."""
    parser = build_experiment_parser(
        "Run the mission-reference correction SwarmFix experiment.",
        "outputs/05_reference_bias_correction",
    )
    args = parser.parse_args()
    run_and_export("configs/04_mission_reference.toml", args.output_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

