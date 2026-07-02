"""Run the common-bias failure case experiment."""

from helpers import build_experiment_parser, run_and_export


def main() -> int:
    """Run the pure common-bias scenario and print the limitation."""
    parser = build_experiment_parser(
        "Run the common-bias failure SwarmFix experiment.",
        "outputs/04_common_bias_failure_case",
    )
    args = parser.parse_args()
    run_and_export("configs/03_common_bias_failure.toml", args.output_dir)
    print("Limitation: UWB cannot remove shared translation without a reference.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

