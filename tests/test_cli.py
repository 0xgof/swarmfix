"""Tests for command-line execution surfaces."""

import tomllib

import pytest


def test_cli_main_runs_config_and_writes_scene_artifacts(tmp_path,
                                                         capsys,
                                                         monkeypatch) -> None:
    """CLI execution should run a config and write both viewer artifacts."""
    from swarmfix.cli import main

    output_dir = tmp_path / "square_cli"
    monkeypatch.setenv("SWARMFIX_OBSERVABILITY_ROOT", str(tmp_path / "logs"))

    exit_code = main([
        "configs/01_square_static.toml",
        "--output-dir",
        str(output_dir),
    ])

    captured = capsys.readouterr()
    assert exit_code == 0
    assert "Run complete" in captured.out
    assert "Scenario: square_static" in captured.out
    assert (output_dir / "scene.json").is_file()
    assert (output_dir / "scene_trace.json").is_file()
    event_files = list((tmp_path / "logs").glob("*/trace_events.jsonl"))
    assert len(event_files) == 1
    event_text = event_files[0].read_text(encoding="utf-8")
    assert "cli_run_started" in event_text
    assert "cli_artifact_written" in event_text
    assert "cli_run_completed" in event_text


def test_cli_parser_documents_arguments_and_rejects_missing_config(capsys) -> None:
    """CLI parser should expose help and fail cleanly without a config path."""
    from swarmfix.cli import build_parser

    parser = build_parser()
    help_text = parser.format_help()

    assert "config" in help_text
    assert "--output-dir" in help_text
    with pytest.raises(SystemExit) as exc_info:
        parser.parse_args([])

    captured = capsys.readouterr()
    assert exc_info.value.code == 2
    assert "config" in captured.err


def test_cli_main_reports_missing_config_path_as_file_error(tmp_path,
                                                            monkeypatch) -> None:
    """CLI execution should not silently succeed for a missing config path."""
    from swarmfix.cli import main

    missing_config = tmp_path / "missing.toml"
    monkeypatch.setenv("SWARMFIX_OBSERVABILITY_ROOT", str(tmp_path / "logs"))

    with pytest.raises(FileNotFoundError):
        main([str(missing_config)])

    event_files = list((tmp_path / "logs").glob("*/trace_events.jsonl"))
    assert len(event_files) == 1
    assert "cli_run_failed" in event_files[0].read_text(encoding="utf-8")


def test_pyproject_declares_cli_console_scripts() -> None:
    """Packaging metadata should expose program entry points."""
    with open("pyproject.toml", "rb") as pyproject_file:
        pyproject_data = tomllib.load(pyproject_file)

    scripts = pyproject_data["project"]["scripts"]
    assert scripts["swarmfix-run"] == "swarmfix.cli:main"
    assert scripts["swarmfix-run-all"] == "swarmfix.run_all_configs:main"
    assert scripts["swarmfix-live-server"] == "swarmfix.live.server:main"


def test_all_root_configs_load_and_run_through_pipeline() -> None:
    """Every root TOML config should be executable by the pipeline."""
    from pathlib import Path

    from swarmfix.workflow.run_pipeline import run_pipeline

    config_paths = sorted(Path("configs").glob("*.toml"))
    assert len(config_paths) == 5

    scenario_names = []
    for config_path in config_paths:
        pipeline_result = run_pipeline(config_path)
        scenario_names.append(pipeline_result.scenario.name)
        assert pipeline_result.measurements.gnss
        assert "gnss_only" in pipeline_result.estimates
        assert "fused" in pipeline_result.estimates

    assert scenario_names == [
        "square_static",
        "grid_10_agents",
        "common_bias_failure",
        "mission_reference",
        "spatially_correlated_gnss",
    ]


def test_readme_documents_program_execution_not_only_tests() -> None:
    """User-facing README should include direct program execution commands."""
    readme_text = open("README.md", encoding="utf-8").read()

    assert "python -m swarmfix.cli" in readme_text
    assert "--output-dir" in readme_text
    assert "scene.json" in readme_text
    assert "scene_trace.json" in readme_text


def test_run_all_configs_executes_each_config_and_writes_outputs(tmp_path,
                                                                 capsys,
                                                                 monkeypatch) -> None:
    """The run-all command should execute every config and report each one."""
    from swarmfix.run_all_configs import main

    monkeypatch.setenv("SWARMFIX_OBSERVABILITY_ROOT", str(tmp_path / "logs"))
    exit_code = main([
        "configs",
        "--output-root",
        str(tmp_path),
    ])

    captured = capsys.readouterr()
    assert exit_code == 0
    assert "01_square_static.toml: ok" in captured.out
    assert "05_spatially_correlated_gnss.toml: ok" in captured.out
    assert (tmp_path / "01_square_static" / "scene.json").is_file()
    assert (tmp_path / "05_spatially_correlated_gnss" / "scene_trace.json").is_file()
    event_files = list((tmp_path / "logs").glob("*/trace_events.jsonl"))
    assert len(event_files) == 1
    event_text = event_files[0].read_text(encoding="utf-8")
    assert "run_all_started" in event_text
    assert "run_all_config_completed" in event_text
    assert "run_all_completed" in event_text


def test_run_all_configs_reports_empty_config_directory(tmp_path,
                                                        capsys) -> None:
    """Run-all should fail nonzero when there are no TOML configs."""
    from swarmfix.run_all_configs import main

    exit_code = main([str(tmp_path), "--output-root", str(tmp_path / "outputs")])

    captured = capsys.readouterr()
    assert exit_code == 1
    assert "No TOML configs found" in captured.out


def test_run_all_configs_continues_after_failed_config(tmp_path,
                                                       capsys,
                                                       monkeypatch) -> None:
    """Run-all should report bad configs and still execute later configs."""
    from swarmfix.run_all_configs import main

    monkeypatch.setenv("SWARMFIX_OBSERVABILITY_ROOT", str(tmp_path / "logs"))
    config_dir = tmp_path / "configs"
    config_dir.mkdir()
    bad_config = config_dir / "01_bad.toml"
    bad_config.write_text("not = [valid", encoding="utf-8")
    good_config = config_dir / "02_good.toml"
    good_config.write_text(open("configs/01_square_static.toml", encoding="utf-8").read(), encoding="utf-8")

    exit_code = main([str(config_dir), "--output-root", str(tmp_path / "outputs")])

    captured = capsys.readouterr()
    assert exit_code == 1
    assert "01_bad.toml: failed" in captured.out
    assert "02_good.toml: ok" in captured.out
    assert (tmp_path / "outputs" / "02_good" / "scene.json").is_file()
    event_files = list((tmp_path / "logs").glob("*/trace_events.jsonl"))
    assert len(event_files) == 1
    event_text = event_files[0].read_text(encoding="utf-8")
    assert "run_all_config_failed" in event_text
    assert "run_all_completed" in event_text


def test_run_all_parser_documents_defaults() -> None:
    """Run-all parser help should document config and output locations."""
    from swarmfix.run_all_configs import build_parser

    parser = build_parser()
    help_text = parser.format_help()

    assert "config_dir" in help_text
    assert "--output-root" in help_text
