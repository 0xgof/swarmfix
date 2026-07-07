"""Summaries for live solver quality observability logs."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class QualityGroupSummary:
    """Aggregated quality and performance counters for one scenario bucket."""

    key: str
    solve_samples: int = 0
    solve_fused_worse_count: int = 0
    display_samples: int = 0
    display_fused_worse_count: int = 0
    slow_frame_count: int = 0
    max_response_age_ms: float | None = None


@dataclass
class QualityLogSummary:
    """Top-level summary returned by the quality log analyzer."""

    groups: dict[str, QualityGroupSummary] = field(default_factory=dict)


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    """Read a JSONL file, returning no records when the file is absent."""
    if not path.is_file():
        return []

    records = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        records.append(json.loads(line))
    return records


def _field_number(fields: dict[str, Any], name: str) -> float | None:
    """Return a numeric field when present."""
    field_value = fields.get(name)
    if isinstance(field_value, int | float):
        return float(field_value)
    return None


def _group_key(fields: dict[str, Any]) -> str:
    """Build the stable quality-report group key."""
    motion_mode = fields.get("motion_mode", "unknown")
    selected_uwb = (
        fields.get("selected_uwb_count")
        if "selected_uwb_count" in fields
        else fields.get("selected_uwb_links", "unknown")
    )
    key = f"motion={motion_mode}|uwb={selected_uwb}"
    return key


def _group_for(summary: QualityLogSummary,
               fields: dict[str, Any]) -> QualityGroupSummary:
    """Return the mutable group summary for one record."""
    key = _group_key(fields)
    group = summary.groups.get(key)
    if group is None:
        group = QualityGroupSummary(key=key)
        summary.groups[key] = group
    return group


def _record_response_age(group: QualityGroupSummary,
                         fields: dict[str, Any]) -> None:
    """Update max response age from a record when present."""
    response_age_ms = _field_number(fields, "response_age_ms")
    if response_age_ms is None:
        return
    group.max_response_age_ms = (
        response_age_ms
        if group.max_response_age_ms is None
        else max(group.max_response_age_ms, response_age_ms)
    )


def summarize_quality_logs(log_dir: Path | str) -> QualityLogSummary:
    """Summarize live solver quality and display quality JSONL logs."""
    root = Path(log_dir)
    summary = QualityLogSummary()
    for event in _read_jsonl(root / "trace_events.jsonl"):
        fields = event.get("fields", {})
        if not isinstance(fields, dict):
            continue
        group = _group_for(summary, fields)
        if event.get("event") == "live_solve_completed":
            group.solve_samples += 1
            if fields.get("fused_worse_than_gnss") is True:
                group.solve_fused_worse_count += 1
        elif event.get("event") == "live_solve_quality_displayed":
            group.display_samples += 1
            display_error = _field_number(fields, "display_error_rmse_m")
            display_gnss_error = _field_number(fields, "display_gnss_error_rmse_m")
            if (
                display_error is not None
                and display_gnss_error is not None
                and display_error > display_gnss_error
            ):
                group.display_fused_worse_count += 1
            _record_response_age(group, fields)

    for sample in _read_jsonl(root / "performance_samples.jsonl"):
        fields = sample.get("fields", {})
        if not isinstance(fields, dict):
            continue
        group = _group_for(summary, fields)
        if sample.get("metric_name") == "frame_ms" and sample.get("is_slow") is True:
            group.slow_frame_count += 1
        _record_response_age(group, fields)

    return summary
