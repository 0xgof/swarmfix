"""Smoke tests for runnable experiment scripts."""

import os
import json
import subprocess
import sys
import csv
from pathlib import Path


def run_experiment(script_name: str,
                   output_dir: Path,
                   observability_root: Path | None = None) -> subprocess.CompletedProcess:
    """Run one experiment script from the repository root."""
    environment = os.environ.copy()
    environment["MPLBACKEND"] = "Agg"
    if observability_root is not None:
        environment["SWARMFIX_OBSERVABILITY_ROOT"] = str(observability_root)
    completed_process = subprocess.run(
        [
            sys.executable,
            str(Path("experiments") / script_name),
            "--output-dir",
            str(output_dir),
        ],
        check=False,
        capture_output=True,
        text=True,
        env=environment,
    )
    return completed_process


def test_baseline_topology_fusion_and_failure_experiments_run(tmp_path) -> None:
    """Experiments 01 through 04 should run and write viewer artifacts."""
    scripts = [
        "01_gnss_only_baseline.py",
        "02_known_topology_alignment.py",
        "03_uwb_gnss_fusion.py",
        "04_common_bias_failure_case.py",
    ]

    for script_name in scripts:
        output_dir = tmp_path / script_name.removesuffix(".py")
        completed_process = run_experiment(script_name, output_dir)

        assert completed_process.returncode == 0, completed_process.stderr
        assert "Run complete" in completed_process.stdout
        assert (output_dir / "scene.json").is_file()
        assert (output_dir / "scene_trace.json").is_file()


def test_experiment_helper_writes_observability_events(tmp_path) -> None:
    """Experiment scripts should create session logs and artifact events."""
    output_dir = tmp_path / "01_gnss_only_baseline"
    observability_root = tmp_path / "logs"

    completed_process = run_experiment(
        "01_gnss_only_baseline.py",
        output_dir,
        observability_root=observability_root,
    )

    assert completed_process.returncode == 0, completed_process.stderr
    event_files = list(observability_root.glob("*/trace_events.jsonl"))
    assert len(event_files) == 1
    event_text = event_files[0].read_text(encoding="utf-8")
    assert "experiment_run_started" in event_text
    assert "experiment_artifact_written" in event_text
    assert "experiment_run_completed" in event_text


def test_reference_full_workflow_and_viewer_export_experiments_run(tmp_path) -> None:
    """Experiments 05 through 08 should run and write their expected artifacts."""
    scripts = [
        "05_reference_bias_correction.py",
        "06_full_workflow_demo.py",
        "07_export_threejs_scene.py",
        "08_solver_trace_viewer_demo.py",
    ]

    for script_name in scripts:
        output_dir = tmp_path / script_name.removesuffix(".py")
        completed_process = run_experiment(script_name, output_dir)

        assert completed_process.returncode == 0, completed_process.stderr
        assert "Run complete" in completed_process.stdout
        assert (output_dir / "scene.json").is_file()
        assert (output_dir / "scene_trace.json").is_file()

    assert (tmp_path / "06_full_workflow_demo" / "estimates.png").is_file()
    assert (tmp_path / "06_full_workflow_demo" / "estimates_uwb.png").is_file()
    assert (tmp_path / "06_full_workflow_demo" / "errors.png").is_file()
    assert (tmp_path / "06_full_workflow_demo" / "cost_trace.png").is_file()
    full_workflow_scene = json.loads(
        (tmp_path / "06_full_workflow_demo" / "scene.json").read_text(encoding="utf-8")
    )
    assert set(full_workflow_scene["estimates"]) == {"gnss_only", "fused"}
    assert not full_workflow_scene["measurements"]["references"]


def test_uwb_link_density_sweep_reports_metrics_by_link_count(tmp_path) -> None:
    """Experiment 09 should report performance as UWB link count changes."""
    output_dir = tmp_path / "09_uwb_link_density_sweep"
    completed_process = run_experiment("09_uwb_link_density_sweep.py", output_dir)

    assert completed_process.returncode == 0, completed_process.stderr
    assert "Sweep complete" in completed_process.stdout
    csv_path = output_dir / "link_density_metrics.csv"
    plot_path = output_dir / "link_density_rmse.png"
    assert csv_path.is_file()
    assert plot_path.is_file()

    rows = list(csv.DictReader(csv_path.open(encoding="utf-8")))
    link_counts = [int(row["uwb_link_count"]) for row in rows]
    assert link_counts == sorted(link_counts)
    assert link_counts[0] == 0
    assert link_counts[-1] > link_counts[0]
    assert {"absolute_rmse", "relative_rmse"} <= set(rows[0])


def test_live_solver_profile_script_accepts_backend_selection() -> None:
    """Experiment 10 should benchmark a selected live-solver backend."""
    completed_process = subprocess.run(
        [
            sys.executable,
            str(Path("experiments") / "10_profile_live_solve.py"),
            "--agents",
            "3",
            "--links",
            "2",
            "--max-iterations",
            "5",
            "--repeat",
            "0",
            "--top",
            "1",
            "--solver-backend",
            "python-scipy",
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed_process.returncode == 0, completed_process.stderr
    assert "solver backend: python-scipy" in completed_process.stdout
