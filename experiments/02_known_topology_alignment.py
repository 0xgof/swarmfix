"""Run the known-topology rigid alignment experiment."""

from helpers import build_experiment_parser, run_and_export


def main() -> int:
    """Run rigid topology alignment alongside the normal pipeline outputs."""
    parser = build_experiment_parser(
        "Run the known-topology alignment SwarmFix experiment.",
        "outputs/02_known_topology_alignment",
    )
    args = parser.parse_args()
    run_and_export(
        "configs/01_square_static.toml",
        args.output_dir,
        include_rigid_fit=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

