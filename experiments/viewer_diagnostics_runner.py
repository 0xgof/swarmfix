"""Autonomous viewer diagnostics runner and report helpers.

This module coordinates the live backend, viewer dev server, browser scenario
control, and observability-log summaries used by experiment 11.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator

REPO_ROOT = Path(__file__).resolve().parents[1]
VIEWER_ROOT = REPO_ROOT / "viewer"
DEFAULT_OBSERVABILITY_ROOT = REPO_ROOT / "logs" / "observability"
DEFAULT_OUTPUT_ROOT = REPO_ROOT / "logs" / "viewer-diagnostics"


@dataclass(frozen=True)
class ScenarioConfig:
    """Configuration for one browser-driven viewer diagnostics scenario."""

    name: str
    formation: str
    motion: str
    speed_mps: float = 0.0
    random_walk_amplitude_m: float = 0.2
    drone_count: int = 10
    uwb_links_per_drone: int = 7
    warmup_s: float = 5.0
    duration_s: float = 30.0


@dataclass
class MetricStats:
    """Small percentile summary for one numeric metric."""

    count: int = 0
    min: float | None = None
    max: float | None = None
    mean: float | None = None
    p50: float | None = None
    p95: float | None = None
    p99: float | None = None
    values: list[float] = field(default_factory=list, repr=False)

    def add(self, value: float | None) -> None:
        """Add one finite numeric value to the summary."""
        if value is None:
            return
        if not isinstance(value, int | float):
            return
        self.values.append(float(value))
        self._refresh()

    def to_json(self) -> dict[str, float | int | None]:
        """Return a JSON-safe summary without retained raw samples."""
        summary = {
            "count": self.count,
            "min": self.min,
            "max": self.max,
            "mean": self.mean,
            "p50": self.p50,
            "p95": self.p95,
            "p99": self.p99,
        }
        return summary

    def _refresh(self) -> None:
        sorted_values = sorted(self.values)
        self.count = len(sorted_values)
        if self.count == 0:
            return
        self.min = sorted_values[0]
        self.max = sorted_values[-1]
        self.mean = sum(sorted_values) / self.count
        self.p50 = _percentile(sorted_values, 0.50)
        self.p95 = _percentile(sorted_values, 0.95)
        self.p99 = _percentile(sorted_values, 0.99)


@dataclass
class ScenarioMetrics:
    """Aggregated diagnostics metrics for one scenario run."""

    scenario: ScenarioConfig
    frame_ms: MetricStats = field(default_factory=MetricStats)
    live_solve_ms: MetricStats = field(default_factory=MetricStats)
    backend_solve_ms: MetricStats = field(default_factory=MetricStats)
    response_age_ms: MetricStats = field(default_factory=MetricStats)
    display_error_rmse_m: MetricStats = field(default_factory=MetricStats)
    display_gnss_error_rmse_m: MetricStats = field(default_factory=MetricStats)
    solver_snapshot_error_rmse_m: MetricStats = field(default_factory=MetricStats)
    solver_snapshot_gnss_error_rmse_m: MetricStats = field(default_factory=MetricStats)
    display_solver_discrepancy_m: MetricStats = field(default_factory=MetricStats)
    slow_frame_phases: dict[str, MetricStats] = field(default_factory=dict)
    slow_frame_count: int = 0
    display_worse_than_gnss_count: int = 0
    solver_worse_than_gnss_count: int = 0
    display_loses_solver_wins_count: int = 0

    @classmethod
    def for_scenario(cls, scenario: ScenarioConfig) -> "ScenarioMetrics":
        """Create an empty metrics record for a scenario."""
        metrics = cls(scenario=scenario)
        return metrics

    def to_json(self) -> dict[str, Any]:
        """Return a JSON-safe representation for report artifacts."""
        scenario_data = {
            "name": self.scenario.name,
            "formation": self.scenario.formation,
            "motion": self.scenario.motion,
            "speed_mps": self.scenario.speed_mps,
            "random_walk_amplitude_m": self.scenario.random_walk_amplitude_m,
            "drone_count": self.scenario.drone_count,
            "uwb_links_per_drone": self.scenario.uwb_links_per_drone,
        }
        metrics_data = {
            "scenario": scenario_data,
            "name": self.scenario.name,
            "frame_ms": self.frame_ms.to_json(),
            "live_solve_ms": self.live_solve_ms.to_json(),
            "backend_solve_ms": self.backend_solve_ms.to_json(),
            "response_age_ms": self.response_age_ms.to_json(),
            "display_error_rmse_m": self.display_error_rmse_m.to_json(),
            "display_gnss_error_rmse_m": self.display_gnss_error_rmse_m.to_json(),
            "solver_snapshot_error_rmse_m": self.solver_snapshot_error_rmse_m.to_json(),
            "solver_snapshot_gnss_error_rmse_m": (
                self.solver_snapshot_gnss_error_rmse_m.to_json()
            ),
            "display_solver_discrepancy_m": self.display_solver_discrepancy_m.to_json(),
            "slow_frame_count": self.slow_frame_count,
            "display_worse_than_gnss_count": self.display_worse_than_gnss_count,
            "solver_worse_than_gnss_count": self.solver_worse_than_gnss_count,
            "display_loses_solver_wins_count": self.display_loses_solver_wins_count,
            "slow_frame_phases": {
                name: stats.to_json()
                for name, stats in sorted(self.slow_frame_phases.items())
            },
        }
        return metrics_data


def default_scenarios() -> list[ScenarioConfig]:
    """Return the default diagnostics matrix for the first autonomous run."""
    scenarios = [
        ScenarioConfig(
            name="baseline_static",
            formation="grid",
            motion="static",
            speed_mps=0.0,
        ),
        ScenarioConfig(
            name="fast_straight_line",
            formation="line",
            motion="forward",
            speed_mps=4.0,
        ),
        ScenarioConfig(
            name="fast_square_patrol",
            formation="square_patrol",
            motion="path_follow",
            speed_mps=4.0,
        ),
        ScenarioConfig(
            name="fast_random_walk",
            formation="grid",
            motion="random_walk",
            speed_mps=3.0,
            random_walk_amplitude_m=1.0,
        ),
    ]
    return scenarios


def summarize_scenario_logs(scenario: ScenarioConfig,
                            scenario_dir: Path) -> ScenarioMetrics:
    """Summarize copied observability logs for one scenario."""
    metrics = ScenarioMetrics.for_scenario(scenario)
    for sample in _read_jsonl(scenario_dir / "performance_samples.jsonl"):
        _summarize_performance_sample(metrics, sample)
    for event in _read_jsonl(scenario_dir / "trace_events.jsonl"):
        _summarize_trace_event(metrics, event)
    return metrics


def write_scenario_report(output_dir: Path,
                          metrics: list[ScenarioMetrics],
                          session_paths: dict[str, str]) -> None:
    """Write Markdown and JSON report artifacts for one diagnostics run."""
    output_dir.mkdir(parents=True, exist_ok=True)
    report_data = {
        "scenarios": [scenario_metrics.to_json() for scenario_metrics in metrics],
    }
    (output_dir / "scenario_results.json").write_text(
        json.dumps(report_data, indent=2),
        encoding="utf-8",
    )
    (output_dir / "session_paths.json").write_text(
        json.dumps(session_paths, indent=2),
        encoding="utf-8",
    )
    markdown = _format_markdown_report(metrics, session_paths)
    (output_dir / "scenario_results.md").write_text(markdown, encoding="utf-8")


def run_diagnostics(args: argparse.Namespace) -> int:
    """Run the autonomous viewer diagnostics experiment."""
    output_dir = _run_output_dir(Path(args.output_dir))
    scenario_root = output_dir / "scenarios"
    scenario_root.mkdir(parents=True, exist_ok=True)
    scenario_metrics: list[ScenarioMetrics] = []
    session_paths: dict[str, str] = {}
    browser_console_path = output_dir / "browser_console.jsonl"
    run_config = {
        "viewer_url": args.viewer_url,
        "backend_url": args.backend_url,
        "duration_s": args.duration_s,
        "warmup_s": args.warmup_s,
        "scenarios": [scenario.to_json() if hasattr(scenario, "to_json") else {
            "name": scenario.name,
            "formation": scenario.formation,
            "motion": scenario.motion,
            "speed_mps": scenario.speed_mps,
            "random_walk_amplitude_m": scenario.random_walk_amplitude_m,
            "drone_count": scenario.drone_count,
            "uwb_links_per_drone": scenario.uwb_links_per_drone,
        } for scenario in _scenarios_from_args(args)],
    }
    (output_dir / "run_config.json").write_text(
        json.dumps(run_config, indent=2),
        encoding="utf-8",
    )

    environment = os.environ.copy()
    environment["SWARMFIX_OBSERVABILITY_ROOT"] = str(args.observability_root)
    backend_process: subprocess.Popen[str] | None = None
    viewer_process: subprocess.Popen[str] | None = None
    try:
        if not args.attach_backend:
            backend_process = _start_backend(args, environment)
            _wait_for_http(f"{args.backend_url}/health", args.startup_timeout_s)
        if not args.attach_viewer:
            viewer_process = _start_viewer(args, environment)
            _wait_for_http(args.viewer_url, args.startup_timeout_s)

        driver = PlaywrightScenarioDriver(args.viewer_url, browser_console_path)
        driver.open()
        for scenario in _scenarios_from_args(args):
            scenario_dir = scenario_root / scenario.name
            scenario_dir.mkdir(parents=True, exist_ok=True)
            before_sessions = _session_dirs(Path(args.observability_root))
            driver.apply_scenario(scenario)
            time.sleep(scenario.warmup_s)
            driver.reset_diagnostics()
            time.sleep(scenario.duration_s)
            time.sleep(args.flush_wait_s)
            scenario_session = _copy_latest_logs(
                Path(args.observability_root),
                scenario_dir,
                before_sessions,
            )
            if scenario_session is not None:
                session_paths[scenario.name] = str(scenario_session)
            scenario_metrics.append(summarize_scenario_logs(scenario, scenario_dir))
        write_scenario_report(output_dir, scenario_metrics, session_paths)
        print(f"Viewer diagnostics complete: {output_dir}")
        return 0
    finally:
        if "driver" in locals():
            driver.close()
        _terminate_process(viewer_process)
        _terminate_process(backend_process)


class PlaywrightScenarioDriver:
    """Browser automation adapter for applying viewer scenario controls."""

    def __init__(self,
                 viewer_url: str,
                 console_path: Path) -> None:
        self.viewer_url = viewer_url
        self.console_path = console_path
        self.playwright = None
        self.browser = None
        self.page = None

    def open(self) -> None:
        """Open the browser page and wait for the viewer controls."""
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as error:
            raise RuntimeError(
                "Playwright is required for autonomous viewer diagnostics. "
                "Install it in the Python environment with "
                "`python -m pip install playwright` and run "
                "`python -m playwright install chromium`."
            ) from error

        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(headless=True)
        self.page = self.browser.new_page()
        self.page.on("console", self._record_console_message)
        self.page.goto(self.viewer_url)
        self.page.wait_for_selector('[name="formation"]', timeout=30_000)
        self.page.wait_for_selector(".link-count-control input", timeout=30_000)

    def apply_scenario(self, scenario: ScenarioConfig) -> None:
        """Set mission and link controls for one scenario."""
        if self.page is None:
            raise RuntimeError("browser page is not open")
        self._select("[name='missionDroneCount']", str(scenario.drone_count))
        self._select("[name='formation']", scenario.formation)
        self._select("[name='motion']", scenario.motion)
        self._fill("[name='speedMps']", str(scenario.speed_mps))
        self._fill(
            "[name='randomWalkAmplitudeM']",
            str(scenario.random_walk_amplitude_m),
        )
        self._fill(".link-count-control input", str(scenario.uwb_links_per_drone))

    def reset_diagnostics(self) -> None:
        """Reset diagnostics history when the reset button is present."""
        if self.page is None:
            raise RuntimeError("browser page is not open")
        reset_button = self.page.locator(".diagnostics-timeline-reset")
        if reset_button.count() > 0:
            reset_button.first.click()

    def close(self) -> None:
        """Close browser resources if they were opened."""
        if self.browser is not None:
            self.browser.close()
            self.browser = None
        if self.playwright is not None:
            self.playwright.stop()
            self.playwright = None

    def _select(self,
                selector: str,
                value: str) -> None:
        self.page.select_option(selector, value=value)

    def _fill(self,
              selector: str,
              value: str) -> None:
        self.page.fill(selector, value)
        self.page.dispatch_event(selector, "input")
        self.page.dispatch_event(selector, "change")

    def _record_console_message(self,
                                message: Any) -> None:
        self.console_path.parent.mkdir(parents=True, exist_ok=True)
        record = {
            "type": message.type,
            "text": message.text,
        }
        with self.console_path.open("a", encoding="utf-8") as console_file:
            console_file.write(json.dumps(record) + "\n")


def build_parser() -> argparse.ArgumentParser:
    """Build the CLI parser for the diagnostics experiment."""
    parser = argparse.ArgumentParser(
        description="Launch the live viewer, run scenarios, and summarize performance."
    )
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_ROOT))
    parser.add_argument("--observability-root", type=Path, default=DEFAULT_OBSERVABILITY_ROOT)
    parser.add_argument("--viewer-url", default="http://127.0.0.1:5174/")
    parser.add_argument("--backend-url", default="http://127.0.0.1:8765")
    parser.add_argument("--viewer-port", type=int, default=5174)
    parser.add_argument("--backend-host", default="127.0.0.1")
    parser.add_argument("--backend-port", type=int, default=8765)
    parser.add_argument("--duration-s", type=float, default=None)
    parser.add_argument("--warmup-s", type=float, default=None)
    parser.add_argument("--flush-wait-s", type=float, default=2.0)
    parser.add_argument("--startup-timeout-s", type=float, default=30.0)
    parser.add_argument("--attach-backend", action="store_true")
    parser.add_argument("--attach-viewer", action="store_true")
    parser.add_argument("--scenario", action="append", default=[])
    return parser


def main(argv: list[str] | None = None) -> int:
    """CLI entry point for the autonomous diagnostics runner."""
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        status = run_diagnostics(args)
    except Exception as error:
        print(f"viewer diagnostics failed: {error}", file=sys.stderr)
        return 1
    return status


def _summarize_performance_sample(metrics: ScenarioMetrics,
                                  sample: dict[str, Any]) -> None:
    metric_name = sample.get("metric_name")
    duration_ms = _number(sample.get("duration_ms"))
    fields = sample.get("fields", {})
    if not isinstance(fields, dict):
        fields = {}
    if metric_name == "frame_ms":
        metrics.frame_ms.add(duration_ms)
        if sample.get("is_slow") is True:
            metrics.slow_frame_count += 1
        response_age_ms = _number(fields.get("response_age_ms"))
        display_error = _number(fields.get("display_error_rmse_m"))
        display_gnss_error = _number(fields.get("display_gnss_error_rmse_m"))
        solve_error = _number(fields.get("latest_solve_error_rmse_m"))
        solve_gnss_error = _number(fields.get("latest_gnss_truth_error_rmse_m"))
        metrics.response_age_ms.add(response_age_ms)
        metrics.display_error_rmse_m.add(display_error)
        metrics.display_gnss_error_rmse_m.add(display_gnss_error)
        metrics.solver_snapshot_error_rmse_m.add(solve_error)
        metrics.solver_snapshot_gnss_error_rmse_m.add(solve_gnss_error)
        if display_error is not None and solve_error is not None:
            discrepancy = display_error - solve_error
            metrics.display_solver_discrepancy_m.add(discrepancy)
        _record_quality_counts(metrics, display_error, display_gnss_error,
                               solve_error, solve_gnss_error)
    elif metric_name == "frame_phase_ms":
        phase_name = fields.get("phase_name")
        if isinstance(phase_name, str):
            phase_stats = metrics.slow_frame_phases.get(phase_name)
            if phase_stats is None:
                phase_stats = MetricStats()
                metrics.slow_frame_phases[phase_name] = phase_stats
            phase_stats.add(duration_ms)
    elif metric_name == "live_solve_ms":
        metrics.live_solve_ms.add(duration_ms)


def _summarize_trace_event(metrics: ScenarioMetrics,
                           event: dict[str, Any]) -> None:
    if event.get("event") != "live_solve_completed":
        return
    fields = event.get("fields", {})
    if not isinstance(fields, dict):
        fields = {}
    metrics.backend_solve_ms.add(_number(event.get("duration_ms")))
    solve_error = _number(fields.get("solve_error_rmse_m"))
    solve_gnss_error = _number(fields.get("gnss_truth_error_rmse_m"))
    metrics.solver_snapshot_error_rmse_m.add(solve_error)
    metrics.solver_snapshot_gnss_error_rmse_m.add(solve_gnss_error)
    if fields.get("fused_worse_than_gnss") is True:
        metrics.solver_worse_than_gnss_count += 1


def _record_quality_counts(metrics: ScenarioMetrics,
                           display_error: float | None,
                           display_gnss_error: float | None,
                           solve_error: float | None,
                           solve_gnss_error: float | None) -> None:
    display_worse = (
        display_error is not None
        and display_gnss_error is not None
        and display_error > display_gnss_error
    )
    solver_worse = (
        solve_error is not None
        and solve_gnss_error is not None
        and solve_error > solve_gnss_error
    )
    solver_better = (
        solve_error is not None
        and solve_gnss_error is not None
        and solve_error <= solve_gnss_error
    )
    if display_worse:
        metrics.display_worse_than_gnss_count += 1
    if solver_worse:
        metrics.solver_worse_than_gnss_count += 1
    if display_worse and solver_better:
        metrics.display_loses_solver_wins_count += 1


def _read_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    if not path.is_file():
        return iter(())

    def records() -> Iterator[dict[str, Any]]:
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            yield json.loads(line)

    return records()


def _percentile(sorted_values: list[float],
                fraction: float) -> float:
    index = round((len(sorted_values) - 1) * fraction)
    percentile_value = sorted_values[index]
    return percentile_value


def _number(value: Any) -> float | None:
    if isinstance(value, int | float):
        return float(value)
    return None


def _format_value(stats: MetricStats,
                  field_name: str) -> str:
    value = getattr(stats, field_name)
    if value is None:
        return "n/a"
    formatted_value = f"{value:.3f}"
    return formatted_value


def _format_markdown_report(metrics: list[ScenarioMetrics],
                            session_paths: dict[str, str]) -> str:
    lines = [
        "# Viewer Diagnostics Results",
        "",
        "| scenario | frame_ms p95 | slow frames | response age p95 | display err p95 | solver err p95 | discrepancy p95 | session |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for scenario_metrics in metrics:
        name = scenario_metrics.scenario.name
        lines.append(
            "| "
            + " | ".join([
                name,
                _format_value(scenario_metrics.frame_ms, "p95"),
                str(scenario_metrics.slow_frame_count),
                _format_value(scenario_metrics.response_age_ms, "p95"),
                _format_value(scenario_metrics.display_error_rmse_m, "p95"),
                _format_value(scenario_metrics.solver_snapshot_error_rmse_m, "p95"),
                _format_value(scenario_metrics.display_solver_discrepancy_m, "p95"),
                session_paths.get(name, "missing"),
            ])
            + " |"
        )
    lines.append("")
    lines.append("## Slow Frame Phases")
    for scenario_metrics in metrics:
        lines.append("")
        lines.append(f"### {scenario_metrics.scenario.name}")
        if not scenario_metrics.slow_frame_phases:
            lines.append("")
            lines.append("No slow-frame phase samples.")
            continue
        lines.append("")
        lines.append("| phase | p95 ms | max ms | count |")
        lines.append("| --- | ---: | ---: | ---: |")
        for phase_name, phase_stats in sorted(scenario_metrics.slow_frame_phases.items()):
            lines.append(
                f"| {phase_name} | {_format_value(phase_stats, 'p95')} "
                f"| {_format_value(phase_stats, 'max')} | {phase_stats.count} |"
            )
    report = "\n".join(lines) + "\n"
    return report


def _run_output_dir(base_output_dir: Path) -> Path:
    timestamp = time.strftime("%Y%m%dT%H%M%S")
    output_dir = base_output_dir / f"run-{timestamp}"
    return output_dir


def _scenarios_from_args(args: argparse.Namespace) -> list[ScenarioConfig]:
    scenarios = default_scenarios()
    if args.scenario:
        selected = set(args.scenario)
        scenarios = [scenario for scenario in scenarios if scenario.name in selected]
    if args.duration_s is not None or args.warmup_s is not None:
        scenarios = [
            ScenarioConfig(
                name=scenario.name,
                formation=scenario.formation,
                motion=scenario.motion,
                speed_mps=scenario.speed_mps,
                random_walk_amplitude_m=scenario.random_walk_amplitude_m,
                drone_count=scenario.drone_count,
                uwb_links_per_drone=scenario.uwb_links_per_drone,
                warmup_s=args.warmup_s
                if args.warmup_s is not None
                else scenario.warmup_s,
                duration_s=args.duration_s
                if args.duration_s is not None
                else scenario.duration_s,
            )
            for scenario in scenarios
        ]
    return scenarios


def _start_backend(args: argparse.Namespace,
                   environment: dict[str, str]) -> subprocess.Popen[str]:
    command = [
        sys.executable,
        "-m",
        "swarmfix.live.server",
        "--host",
        args.backend_host,
        "--port",
        str(args.backend_port),
    ]
    process = subprocess.Popen(
        command,
        cwd=REPO_ROOT,
        env=environment,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    return process


def _start_viewer(args: argparse.Namespace,
                  environment: dict[str, str]) -> subprocess.Popen[str]:
    command = [
        "npm",
        "run",
        "dev",
        "--",
        "--port",
        str(args.viewer_port),
        "--strictPort",
    ]
    process = subprocess.Popen(
        command,
        cwd=VIEWER_ROOT,
        env=environment,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    return process


def _wait_for_http(url: str,
                   timeout_s: float) -> None:
    import urllib.error
    import urllib.request

    deadline = time.monotonic() + timeout_s
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status < 500:
                    return
        except (urllib.error.URLError, TimeoutError) as error:
            last_error = error
        time.sleep(0.25)
    raise RuntimeError(f"Timed out waiting for {url}: {last_error}")


def _session_dirs(root: Path) -> set[Path]:
    if not root.is_dir():
        return set()
    sessions = {
        path
        for path in root.iterdir()
        if path.is_dir() and path.name.startswith("session-")
    }
    return sessions


def _copy_latest_logs(observability_root: Path,
                      scenario_dir: Path,
                      before_sessions: set[Path]) -> Path | None:
    sessions = sorted(
        _session_dirs(observability_root),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    selected_session = next(
        (session for session in sessions if session not in before_sessions),
        sessions[0] if sessions else None,
    )
    if selected_session is None:
        return None
    for filename in ("performance_samples.jsonl", "trace_events.jsonl"):
        source_path = selected_session / filename
        if source_path.is_file():
            shutil.copy2(source_path, scenario_dir / filename)
    return selected_session


def _terminate_process(process: subprocess.Popen[str] | None) -> None:
    if process is None:
        return
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)
