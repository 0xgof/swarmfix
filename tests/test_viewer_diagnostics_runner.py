"""Tests for the autonomous viewer diagnostics experiment runner."""

from __future__ import annotations

import json
from pathlib import Path

from experiments.viewer_diagnostics_runner import (
    ScenarioConfig,
    ScenarioMetrics,
    default_scenarios,
    summarize_scenario_logs,
    write_scenario_report,
)


def _write_jsonl(path: Path,
                 records: list[dict]) -> None:
    """Write simple JSONL fixture records."""
    path.write_text(
        "\n".join(json.dumps(record) for record in records) + "\n",
        encoding="utf-8",
    )


def test_default_scenarios_cover_baseline_and_fast_motion() -> None:
    """The autonomous run should cover baseline and fast-motion cases."""
    scenarios = default_scenarios()
    scenario_names = {scenario.name for scenario in scenarios}

    assert "baseline_static" in scenario_names
    assert "fast_straight_line" in scenario_names
    assert "fast_square_patrol" in scenario_names
    assert all(scenario.duration_s > 0 for scenario in scenarios)
    assert all(scenario.warmup_s >= 0 for scenario in scenarios)


def test_summarize_scenario_logs_correlates_display_and_solver_quality(tmp_path) -> None:
    """Scenario summaries should expose frame, phase, age, and quality metrics."""
    scenario_dir = tmp_path / "scenario"
    scenario_dir.mkdir()
    _write_jsonl(
        scenario_dir / "performance_samples.jsonl",
        [
            {
                "metric_name": "frame_ms",
                "duration_ms": 16.0,
                "is_slow": False,
                "fields": {
                    "response_age_ms": 100.0,
                    "display_error_rmse_m": 0.5,
                    "display_gnss_error_rmse_m": 0.8,
                    "latest_solve_error_rmse_m": 0.2,
                },
            },
            {
                "metric_name": "frame_ms",
                "duration_ms": 40.0,
                "is_slow": True,
                "fields": {
                    "response_age_ms": 420.0,
                    "display_error_rmse_m": 1.2,
                    "display_gnss_error_rmse_m": 0.8,
                    "latest_solve_error_rmse_m": 0.2,
                    "latest_gnss_truth_error_rmse_m": 0.8,
                },
            },
            {
                "metric_name": "frame_phase_ms",
                "duration_ms": 18.0,
                "is_slow": False,
                "fields": {"phase_name": "scene_update"},
            },
            {
                "metric_name": "live_solve_ms",
                "duration_ms": 85.0,
                "is_slow": False,
                "fields": {},
            },
        ],
    )
    _write_jsonl(
        scenario_dir / "trace_events.jsonl",
        [
            {
                "event": "live_solve_completed",
                "duration_ms": 22.0,
                "fields": {
                    "solve_error_rmse_m": 0.2,
                    "gnss_truth_error_rmse_m": 0.8,
                    "fused_worse_than_gnss": False,
                },
            },
            {
                "event": "live_solve_completed",
                "duration_ms": 24.0,
                "fields": {
                    "solve_error_rmse_m": 0.25,
                    "gnss_truth_error_rmse_m": 0.8,
                    "fused_worse_than_gnss": False,
                },
            },
        ],
    )

    metrics = summarize_scenario_logs(
        ScenarioConfig(name="fast", formation="line", motion="forward"),
        scenario_dir,
    )

    assert metrics.frame_ms.count == 2
    assert metrics.frame_ms.p95 == 40.0
    assert metrics.slow_frame_count == 1
    assert metrics.response_age_ms.max == 420.0
    assert metrics.display_error_rmse_m.p50 == 0.5
    assert metrics.solver_snapshot_error_rmse_m.p50 == 0.2
    assert metrics.display_worse_than_gnss_count == 1
    assert metrics.solver_worse_than_gnss_count == 0
    assert metrics.display_loses_solver_wins_count == 1
    assert "scene_update" in metrics.slow_frame_phases


def test_write_scenario_report_outputs_markdown_and_json(tmp_path) -> None:
    """The runner should write reusable report artifacts for ticket evidence."""
    output_dir = tmp_path / "viewer-diagnostics"
    scenario = ScenarioConfig(name="baseline", formation="grid", motion="static")
    metrics = ScenarioMetrics.for_scenario(scenario)
    metrics.frame_ms.add(16.0)
    metrics.response_age_ms.add(30.0)
    metrics.display_error_rmse_m.add(0.2)
    metrics.solver_snapshot_error_rmse_m.add(0.1)

    write_scenario_report(output_dir, [metrics], {"baseline": "session-a"})

    markdown = (output_dir / "scenario_results.md").read_text(encoding="utf-8")
    summary_json = json.loads(
        (output_dir / "scenario_results.json").read_text(encoding="utf-8")
    )
    session_paths = json.loads(
        (output_dir / "session_paths.json").read_text(encoding="utf-8")
    )

    assert "baseline" in markdown
    assert "frame_ms" in markdown
    assert summary_json["scenarios"][0]["name"] == "baseline"
    assert session_paths["baseline"] == "session-a"
