"""Summaries for session-scoped observability event files."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from swarmfix.observability.performance.metrics import PerformanceMetric
from swarmfix.observability.performance.summary import summarize_metrics


def summarize_event_file(path: Path) -> dict[str, Any]:
    """Count event names and failures from a JSONL observability file."""
    if not path.exists():
        summary = {"count": 0, "events": {}, "failures": 0, "malformed": 0}
        return summary

    event_counts: dict[str, int] = {}
    failures = 0
    malformed = 0
    with path.open("r", encoding="utf-8") as event_file:
        for line in event_file:
            try:
                event_record = json.loads(line)
            except json.JSONDecodeError:
                malformed += 1
                continue
            event_name = str(event_record.get("event", "unknown"))
            event_counts[event_name] = event_counts.get(event_name, 0) + 1
            if event_name.endswith("_failed"):
                failures += 1

    event_count = sum(event_counts.values())
    summary = {
        "count": event_count,
        "events": event_counts,
        "failures": failures,
        "malformed": malformed,
    }
    return summary


def _read_performance_metrics(path: Path) -> tuple[list[PerformanceMetric], int]:
    """Read performance metric JSONL records and count malformed entries."""
    if not path.exists():
        return [], 0

    metrics: list[PerformanceMetric] = []
    malformed = 0
    with path.open("r", encoding="utf-8") as metric_file:
        for line in metric_file:
            try:
                record = json.loads(line)
                metric = PerformanceMetric.model_validate(record)
            except (json.JSONDecodeError, ValidationError):
                malformed += 1
                continue
            metrics.append(metric)
    return metrics, malformed


def write_session_summaries(session_dir: Path) -> tuple[Path, Path]:
    """Write observability and performance summaries for one session folder."""
    event_summary = summarize_event_file(session_dir / "trace_events.jsonl")
    metrics, malformed_metrics = _read_performance_metrics(
        session_dir / "performance_samples.jsonl"
    )
    metric_summary = summarize_metrics(metrics)
    if malformed_metrics:
        metric_summary["_malformed"] = {"count": malformed_metrics}

    event_summary_path = session_dir / "observability_summary.json"
    metric_summary_path = session_dir / "metrics_summary.json"
    event_summary_path.write_text(
        json.dumps(event_summary, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    metric_summary_path.write_text(
        json.dumps(metric_summary, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    summary_paths = (event_summary_path, metric_summary_path)
    return summary_paths
