"""Small timing helpers for observability performance metrics."""

from __future__ import annotations

from contextlib import contextmanager
from time import perf_counter
from typing import Iterator

from swarmfix.observability.performance.metrics import PerformanceMetric


@contextmanager
def measure_metric(trace_id: str,
                   span_id: str,
                   component: str,
                   metric_name: str,
                   slow_threshold_ms: float | None = None) -> Iterator[list[PerformanceMetric]]:
    """Measure a block and append the resulting metric to a one-item list."""
    samples: list[PerformanceMetric] = []
    start_seconds = perf_counter()
    try:
        yield samples
    finally:
        duration_ms = (perf_counter() - start_seconds) * 1000.0
        sample = PerformanceMetric(
            trace_id=trace_id,
            span_id=span_id,
            component=component,
            metric_name=metric_name,
            duration_ms=duration_ms,
            slow_threshold_ms=slow_threshold_ms,
        )
        samples.append(sample)
