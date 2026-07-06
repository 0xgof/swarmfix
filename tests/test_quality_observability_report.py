"""Tests for live solver quality observability summaries."""

from __future__ import annotations

import json


def test_quality_report_groups_solver_and_display_failures(tmp_path) -> None:
    from swarmfix.observability.quality_report import summarize_quality_logs

    trace_events = tmp_path / "trace_events.jsonl"
    performance_samples = tmp_path / "performance_samples.jsonl"
    trace_events.write_text(
        "\n".join([
            json.dumps({
                "event": "live_solve_completed",
                "fields": {
                    "motion_mode": "forward",
                    "solver_backend": "python-scipy",
                    "selected_uwb_count": 3,
                    "solve_error_rmse_m": 0.4,
                    "gnss_truth_error_rmse_m": 1.0,
                    "fused_worse_than_gnss": False,
                },
            }),
            json.dumps({
                "event": "live_solve_quality_displayed",
                "fields": {
                    "motion_mode": "forward",
                    "selected_uwb_links": 3,
                    "display_error_rmse_m": 2.0,
                    "display_gnss_error_rmse_m": 1.0,
                    "response_age_ms": 180,
                },
            }),
        ]),
        encoding="utf-8",
    )
    performance_samples.write_text(
        json.dumps({
            "metric_name": "frame_ms",
            "duration_ms": 42,
            "is_slow": True,
            "fields": {
                "motion_mode": "forward",
                "selected_uwb_links": 3,
                "response_age_ms": 180,
            },
        }) + "\n",
        encoding="utf-8",
    )

    summary = summarize_quality_logs(tmp_path)

    group = summary.groups["motion=forward|uwb=3"]
    assert group.solve_samples == 1
    assert group.solve_fused_worse_count == 0
    assert group.display_samples == 1
    assert group.display_fused_worse_count == 1
    assert group.slow_frame_count == 1
    assert group.max_response_age_ms == 180
