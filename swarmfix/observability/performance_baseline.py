"""Boundary-focused FPS summaries from viewer and backend observability logs."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from swarmfix.observability.performance.metrics import PerformanceMetric
from swarmfix.observability.performance.summary import summarize_metrics


@dataclass(frozen=True)
class PerformanceBaselineSummary:
    """Compact attribution summary for one viewer/backend performance baseline."""

    observability_root: Path
    viewer_session_path: Path | None
    backend_session_path: Path | None
    viewer_metrics: dict[str, dict[str, Any]] = field(default_factory=dict)
    viewer_phase_metrics: dict[str, dict[str, Any]] = field(default_factory=dict)
    backend_metrics: dict[str, dict[str, Any]] = field(default_factory=dict)
    solver_backends: list[str] = field(default_factory=list)
    selected_uwb_links: dict[str, list[int]] = field(default_factory=dict)
    diagnostics: list[str] = field(default_factory=list)


def _session_dirs(observability_root: Path) -> list[Path]:
    """Return session directories newest first from an observability root."""
    if not observability_root.exists():
        return []

    sessions = [
        candidate
        for candidate in observability_root.iterdir()
        if candidate.is_dir()
    ]
    sorted_sessions = sorted(
        sessions,
        key=lambda candidate: candidate.stat().st_mtime,
        reverse=True
    )
    return sorted_sessions


def _read_performance_samples(path: Path) -> list[PerformanceMetric]:
    """Read valid performance samples and ignore malformed JSONL rows."""
    if not path.exists():
        return []

    metrics: list[PerformanceMetric] = []
    with path.open("r", encoding="utf-8") as sample_file:
        for line in sample_file:
            try:
                record = json.loads(line)
                metric = PerformanceMetric.model_validate(record)
            except (json.JSONDecodeError, ValidationError):
                continue
            metrics.append(metric)
    return metrics


def _number_field(record: dict[str, Any],
                  field_name: str) -> float | None:
    """Read a numeric field from an event root or nested fields payload."""
    field_value = record.get(field_name)
    if field_value is None:
        fields = record.get("fields", {})
        if isinstance(fields, dict):
            field_value = fields.get(field_name)
    if isinstance(field_value, int | float):
        return float(field_value)
    return None


def _selected_uwb_field(fields: dict[str, Any]) -> int | None:
    """Read the selected UWB count from known viewer and backend field names."""
    for field_name in ("selected_uwb_links", "selected_uwb_count"):
        field_value = fields.get(field_name)
        if isinstance(field_value, int):
            return field_value
    return None


def _read_backend_events(path: Path) -> tuple[list[PerformanceMetric], list[str], list[int]]:
    """Read backend live-solve completion events as performance metrics."""
    if not path.exists():
        return [], [], []

    metrics: list[PerformanceMetric] = []
    solver_backends: set[str] = set()
    selected_counts: set[int] = set()
    with path.open("r", encoding="utf-8") as event_file:
        for line in event_file:
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if record.get("event") != "live_solve_completed":
                continue

            fields = record.get("fields", {})
            if not isinstance(fields, dict):
                fields = {}
            duration_ms = _number_field(record, "duration_ms")
            if duration_ms is None:
                continue
            backend_name = fields.get("solver_backend")
            if isinstance(backend_name, str):
                solver_backends.add(backend_name)
            selected_count = _selected_uwb_field(fields)
            if selected_count is not None:
                selected_counts.add(selected_count)

            metric = PerformanceMetric(
                trace_id=str(record.get("trace_id", "unknown")),
                span_id=str(record.get("span_id", "unknown")),
                component=str(record.get("component", "python-live-solver")),
                metric_name="live_solve_completed",
                duration_ms=duration_ms,
                fields=fields,
            )
            metrics.append(metric)

    sorted_backends = sorted(solver_backends)
    sorted_selected_counts = sorted(selected_counts)
    return metrics, sorted_backends, sorted_selected_counts


def _latest_viewer_session(session_dirs: list[Path]) -> tuple[Path | None, list[PerformanceMetric]]:
    """Find the latest session with viewer performance samples."""
    for session_dir in session_dirs:
        sample_path = session_dir / "performance_samples.jsonl"
        metrics = _read_performance_samples(sample_path)
        viewer_metrics = [
            metric
            for metric in metrics
            if metric.component == "viewer"
        ]
        if viewer_metrics:
            return session_dir, viewer_metrics
    return None, []


def _latest_backend_session(session_dirs: list[Path]) -> tuple[Path | None,
                                                              list[PerformanceMetric],
                                                              list[str],
                                                              list[int]]:
    """Find the latest session with backend live-solve completion events."""
    for session_dir in session_dirs:
        event_path = session_dir / "trace_events.jsonl"
        metrics, solver_backends, selected_counts = _read_backend_events(event_path)
        if metrics:
            return session_dir, metrics, solver_backends, selected_counts
    return None, [], [], []


def _selected_counts_from_viewer(metrics: list[PerformanceMetric]) -> list[int]:
    """Collect selected UWB counts from viewer performance sample fields."""
    selected_counts: set[int] = set()
    for metric in metrics:
        selected_count = _selected_uwb_field(metric.fields)
        if selected_count is not None:
            selected_counts.add(selected_count)
    sorted_selected_counts = sorted(selected_counts)
    return sorted_selected_counts


def _viewer_phase_metrics(metrics: list[PerformanceMetric]) -> dict[str, dict[str, Any]]:
    """Summarize viewer slow-frame phase samples by phase name."""
    phase_metrics: dict[str, list[PerformanceMetric]] = {}
    for metric in metrics:
        if metric.metric_name != "frame_phase_ms":
            continue
        phase_name = metric.fields.get("phase_name")
        if not isinstance(phase_name, str):
            continue
        phase_group = phase_metrics.get(phase_name, [])
        phase_group.append(metric)
        phase_metrics[phase_name] = phase_group

    phase_summaries: dict[str, dict[str, Any]] = {}
    for phase_name, phase_group in sorted(phase_metrics.items()):
        phase_summary = summarize_metrics(phase_group).get("frame_phase_ms")
        if phase_summary:
            phase_summaries[phase_name] = phase_summary
    return phase_summaries


def summarize_performance_baseline(
        observability_root: Path = Path("logs/observability")) -> PerformanceBaselineSummary:
    """Summarize the latest viewer and backend performance sessions separately."""
    session_dirs = _session_dirs(observability_root)
    viewer_session, viewer_samples = _latest_viewer_session(session_dirs)
    backend_session, backend_samples, solver_backends, backend_selected_counts = (
        _latest_backend_session(session_dirs)
    )

    diagnostics: list[str] = []
    if viewer_session is None:
        diagnostics.append("no viewer performance_samples.jsonl found")
    if backend_session is None:
        diagnostics.append("no backend trace_events.jsonl with live_solve_completed found")

    viewer_metrics = summarize_metrics(viewer_samples)
    viewer_phase_metrics = _viewer_phase_metrics(viewer_samples)
    backend_metrics = summarize_metrics(backend_samples)
    selected_uwb_links = {
        "backend": backend_selected_counts,
        "viewer": _selected_counts_from_viewer(viewer_samples),
    }
    baseline_summary = PerformanceBaselineSummary(
        observability_root=observability_root,
        viewer_session_path=viewer_session,
        backend_session_path=backend_session,
        viewer_metrics=viewer_metrics,
        viewer_phase_metrics=viewer_phase_metrics,
        backend_metrics=backend_metrics,
        solver_backends=solver_backends,
        selected_uwb_links=selected_uwb_links,
        diagnostics=diagnostics,
    )
    return baseline_summary


def _format_metric(name: str,
                   metrics: dict[str, dict[str, Any]]) -> str:
    """Format one metric row or a compact missing marker."""
    metric = metrics.get(name)
    if not metric:
        return f"{name}: missing"

    metric_text = (
        f"{name}: n={metric['count']} "
        f"p50={metric['p50']:.1f}ms "
        f"p95={metric['p95']:.1f}ms "
        f"p99={metric['p99']:.1f}ms "
        f"max={metric['max']:.1f}ms"
    )
    return metric_text


def format_performance_baseline(summary: PerformanceBaselineSummary) -> str:
    """Format a performance baseline summary for terminal or ticket notes."""
    lines = [
        "SwarmFix performance baseline",
        f"root: {summary.observability_root}",
        f"viewer session: {summary.viewer_session_path or 'missing'}",
        f"backend session: {summary.backend_session_path or 'missing'}",
        "",
        "viewer:",
        f"  {_format_metric('frame_ms', summary.viewer_metrics)}",
        f"  {_format_metric('live_solve_ms', summary.viewer_metrics)}",
    ]
    if summary.viewer_phase_metrics:
        lines.append("")
        lines.append("viewer slow-frame phases:")
        for phase_name, phase_metrics in summary.viewer_phase_metrics.items():
            lines.append(f"  {_format_metric(phase_name, {phase_name: phase_metrics})}")
    lines.extend([
        "",
        "backend:",
        f"  {_format_metric('live_solve_completed', summary.backend_metrics)}",
        f"  solver_backends: {', '.join(summary.solver_backends) or 'missing'}",
        "",
        "selected UWB links:",
        f"  viewer: {summary.selected_uwb_links.get('viewer', [])}",
        f"  backend: {summary.selected_uwb_links.get('backend', [])}",
    ])
    if summary.diagnostics:
        lines.append("")
        lines.append("diagnostics:")
        lines.extend(f"  {diagnostic}" for diagnostic in summary.diagnostics)
    formatted_summary = "\n".join(lines)
    return formatted_summary


def build_parser() -> argparse.ArgumentParser:
    """Build the CLI parser for performance baseline summaries."""
    parser = argparse.ArgumentParser(
        description="Summarize latest viewer/backend observability performance logs."
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path("logs/observability"),
        help="Observability root containing session-* directories."
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """Print a compact latest-session performance baseline."""
    parser = build_parser()
    args = parser.parse_args(argv)
    summary = summarize_performance_baseline(args.root)
    print(format_performance_baseline(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
