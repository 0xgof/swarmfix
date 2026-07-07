"""Export a viewer-ready Three.js scene JSON file."""

from helpers import build_experiment_parser, run_and_export


def main() -> int:
    """Run the mission-reference config and export scene JSON."""
    parser = build_experiment_parser(
        "Export a viewer-ready SwarmFix scene.",
        "outputs/07_export_threejs_scene",
    )
    args = parser.parse_args()
    run_and_export("configs/04_mission_reference.toml", args.output_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

