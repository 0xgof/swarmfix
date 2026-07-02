"""Export a solver-trace scene for viewer playback."""

from helpers import build_experiment_parser, run_and_export


def main() -> int:
    """Run the spatial-correlation config and export trace-rich JSON."""
    parser = build_experiment_parser(
        "Export a solver-trace SwarmFix viewer demo.",
        "outputs/08_solver_trace_viewer_demo",
    )
    args = parser.parse_args()
    run_and_export("configs/05_spatially_correlated_gnss.toml", args.output_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

