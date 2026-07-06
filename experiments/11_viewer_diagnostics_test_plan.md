# Viewer Diagnostics Test Plan

Date: 2026-07-06
State: Draft

## Purpose

Define a repeatable diagnostics run that launches the live backend and viewer,
drives representative motion scenarios, and records enough observability data
to explain viewer FPS drops and display-vs-solver error discrepancy.

This is an experiment plan, not a unit-test plan. The first implementation
should collect evidence and produce reports. Hard pass/fail thresholds should
come later, after stable baseline numbers exist.

## Questions To Answer

- Does display tracking error rise because the solver is wrong, or because the
  displayed frame is stale relative to current truth?
- Which viewer phase dominates slow frames?
- Do diagnostics plots, inspector updates, scene updates, or observability
  flushing create frame stalls?
- Does response age explain the gap between display tracking error and solver
  snapshot error?
- Which motion modes, speeds, drone counts, and UWB link counts degrade FPS?

## Runtime Shape

The diagnostics harness should coordinate these processes:

```text
live backend
  python -m swarmfix.live.server --host 127.0.0.1 --port 8765

viewer dev server
  cd viewer
  npm run dev

browser driver
  open viewer URL
  select scenario controls
  wait fixed duration
  flush/collect logs
```

The harness should fail clearly if the backend or viewer cannot start, but it
should not silently skip scenarios.

## Scenario Matrix

Start with a small matrix that proves attribution before expanding coverage.

### Baseline

- 10 drones;
- grid formation;
- stationary or very low speed;
- medium UWB link count;
- diagnostics panel visible.

### Absolute Motion

- straight-line motion, low speed;
- straight-line motion, high speed;
- square patrol, low speed;
- square patrol, high speed.

### Relative Motion

- random walk, low amplitude;
- random walk, high amplitude.

### Load Sweep

- sparse UWB links;
- dense UWB links;
- 10 drones;
- 20 drones;
- larger drone counts only after the standard cases are stable.

Each scenario should run for a fixed duration, such as 30 or 60 seconds, after
a short warm-up period.

## Required Observability Inputs

Collect these files for each run:

- viewer `performance_samples.jsonl`;
- viewer observation events;
- backend `trace_events.jsonl`;
- backend solve quality events;
- optional browser console errors.

The run should preserve the session directory paths in the final report.

## Required Metrics

For each scenario, report:

- `frame_ms` count, median, p95, p99, max;
- slow-frame count and slow-frame ratio;
- slow-frame phase summaries by `phase_name`;
- `live_solve_ms` median, p95, p99, max;
- backend `live_solve_completed` median, p95, p99, max;
- solve response cadence;
- median and p95 `response_age_ms`;
- median and p95 `display_error_rmse_m`;
- median and p95 `display_gnss_error_rmse_m`;
- median and p95 `latest_solve_error_rmse_m`;
- median and p95 display-vs-solver discrepancy:

```text
display_error_rmse_m - latest_solve_error_rmse_m
```

Also report counts where:

- display error is worse than GNSS;
- solver snapshot error is worse than GNSS;
- display error is worse than GNSS while solver snapshot error is better than
  GNSS.

That last count is the clearest signal of display-side discrepancy.

## Phase Attribution

The viewer already records frame phases for slow frames. The diagnostics report
should rank slow-frame phases by p95 and max duration.

Important phases:

- `display_frame`;
- `mission_positions`;
- `live_frame_build`;
- `live_solve_scheduler`;
- `scene_update`;
- `camera_follow`;
- `orbit_controls`;
- `render`;
- `diagnostic_plot_update`;
- `observability_flush_check`.

Interpretation:

- high `scene_update` points to Three.js object sync, line geometry, or marker
  updates;
- high `render` points to GPU/canvas draw cost;
- high `diagnostic_plot_update` points to SVG/DOM plot work;
- high `observability_flush_check` points to logging or network flush overhead;
- high `live_frame_build` points to local measurement/frame generation;
- high `display_frame` points to scheduler/interpolation work.

## Display Discrepancy Attribution

The report should make these comparisons explicit:

```text
solver beats GNSS, display loses to GNSS
display error rises with response age
display error rises with slow frames
display error rises with interpolation transition progress
```

The strongest diagnostic relationship to look for first is:

```text
display_vs_solver_discrepancy by response_age_ms bucket
```

Recommended buckets:

- `0-100 ms`;
- `100-250 ms`;
- `250-500 ms`;
- `500-1000 ms`;
- `>1000 ms`.

If discrepancy rises with response age during fast motion, prioritize display
latency and timestamp alignment. If discrepancy is high even at low response
age, inspect interpolation and frame construction.

## Browser Automation

Prefer Playwright if it is already available in the viewer toolchain.

The browser driver should:

- open the viewer URL;
- wait for the scene to be ready;
- set mission action controls;
- set drone count and UWB link count;
- reset diagnostics;
- run the scenario duration;
- collect final UI labels and console errors;
- move to the next scenario without requiring manual clicks.

If browser automation is blocked, the first implementation may be a manual run
checklist plus a log summarizer. The report format should remain the same so
manual and automated runs are comparable.

## Output Artifacts

Each diagnostics run should create a timestamped output folder:

```text
logs/viewer-diagnostics/<run-id>/
  run_config.json
  scenario_results.json
  scenario_results.md
  session_paths.json
  browser_console.jsonl
```

`scenario_results.md` should be suitable for pasting into a ticket or plan.

## Initial Acceptance Criteria

The first implementation is successful when it can:

- launch or attach to the backend and viewer;
- run at least baseline, fast straight-line, and fast square-patrol scenarios;
- produce a report with frame metrics, slow-frame phase attribution, response
  age, display error, solver snapshot error, and discrepancy;
- preserve links or paths to the raw observability sessions;
- complete without changing solver behavior.

Do not gate on FPS thresholds in the first version. Use the first runs to set
realistic thresholds.

## Future Acceptance Gates

After baseline evidence exists, add gates such as:

- standard 10-drone scenario p95 `frame_ms` under 33 ms;
- no recurring slow-frame phase above a chosen budget;
- solver snapshot beats GNSS in at least 95 percent of solved samples for the
  controlled scenario;
- display-vs-solver discrepancy is explainable by response age or below a
  fixed threshold in low-latency buckets;
- diagnostics plot updates do not appear as a top slow-frame contributor.

## Implementation Notes

Likely first script:

```text
experiments/11_viewer_diagnostics_run.py
```

If the browser automation is TypeScript-based, keep the report writer and
scenario matrix close to the experiment folder, and let the TypeScript driver
focus only on UI control.

The script should avoid brittle timing assertions. It should collect evidence,
summarize it, and leave threshold decisions to follow-up tickets once the
baseline is known.

