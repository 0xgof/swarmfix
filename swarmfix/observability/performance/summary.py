"""Aggregate performance metric samples into compact summaries."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from swarmfix.observability.performance.metrics import PerformanceMetric


def _percentile(sorted_values: list[float], percentile: float) -> float:
    """Return a nearest-rank percentile from sorted values."""
    if not sorted_values:
        raise ValueError("cannot calculate percentile for empty values")
    index = round((len(sorted_values) - 1) * percentile)
    percentile_value = sorted_values[index]
    return percentile_value


def summarize_metrics(metrics: list[PerformanceMetric]) -> dict[str, dict[str, Any]]:
    """Summarize performance metrics by metric name."""
    grouped_metrics: dict[str, list[PerformanceMetric]] = defaultdict(list)
    for metric in metrics:
        grouped_metrics[metric.metric_name].append(metric)

    summaries: dict[str, dict[str, Any]] = {}
    for metric_name, metric_group in grouped_metrics.items():
        durations = sorted(metric.duration_ms for metric in metric_group)
        slow_count = sum(1 for metric in metric_group if metric.is_slow)
        metric_count = len(metric_group)
        metric_summary = {
            "count": metric_count,
            "min": durations[0],
            "max": durations[-1],
            "mean": sum(durations) / metric_count,
            "p50": _percentile(durations, 0.50),
            "p95": _percentile(durations, 0.95),
            "p99": _percentile(durations, 0.99),
            "slow_count": slow_count,
            "slow_ratio": slow_count / metric_count,
        }
        summaries[metric_name] = metric_summary
    return summaries
