"""Run the GNSS-only baseline experiment."""

from helpers import build_experiment_parser, run_and_export


def main() -> int:
    """Run the baseline square config and export viewer artifacts."""
    parser = build_experiment_parser(
        "Run the GNSS-only baseline SwarmFix experiment.",
        "outputs/01_gnss_only_baseline",
    )
    args = parser.parse_args()
    run_and_export("configs/01_square_static.toml", args.output_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

