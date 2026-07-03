# SwarmFix

SwarmFix is a proof-of-concept system for cooperative GNSS/UWB localisation in
swarms of drones, robots, or mobile agents.

The project explores how noisy absolute GNSS measurements and more accurate
inter-agent UWB ranges can be fused to improve swarm-relative geometry while
making the remaining absolute-position limits visible.

## Current Scope

The current implementation includes:

- typed scenario, measurement, estimate, residual, metric, and result records;
- square, grid, trajectory, and topology scenario generation;
- GNSS simulation with common bias, independent noise, spatial correlation, and
  optional outliers;
- UWB range simulation and optional mission reference measurements;
- GNSS-only baseline estimation, rigid topology alignment, weighted GNSS/UWB
  fusion, and mission-level translation bias correction;
- a pluggable solver backend boundary with Python/SciPy and native C UWB/GNSS
  backends;
- absolute, relative, orientation, bias, and comparison metrics;
- TOML config loading with Pydantic validation;
- end-to-end pipeline orchestration and root-config batch execution;
- JSON scene and solver-trace export for viewer replay;
- Python-side plotting helpers and experiment scripts;
- JSONL observability events, performance metrics, and summaries;
- a live Python solve API for the viewer;
- a Vite/Three.js viewer with scene replay, live solve requests, adaptive UWB
  link selection, mission action controls, diagnostics, and a UI catalog.

## Key Limitation

UWB/topology constraints can improve relative formation geometry and reduce
non-common GNSS error. They cannot remove a pure common translation bias of the
whole swarm without an absolute reference such as RTK, fixed anchors, landmarks,
or a known mission reference point.

## Requirements

Use Python 3.11 or newer. The project has been exercised locally with Python
3.12.

The Python package depends on:

- matplotlib
- numpy
- pydantic
- scipy

The viewer uses Node, Vite, TypeScript, Vitest, and Three.js. Install viewer
dependencies from `viewer/` with `npm install`.

The native C solver backend is optional at development time unless you select
or run a path that requires it. Build it from `native/uwb_gnss_solver/` with a C
toolchain and CMake before using the C backend.

## Run The Python Pipeline

Run one TOML config from the repository root:

```bash
python -m swarmfix.cli configs/04_mission_reference.toml --output-dir outputs/mission_reference
```

The command writes:

```text
outputs/mission_reference/scene.json
outputs/mission_reference/scene_trace.json
```

If `--output-dir` is omitted, output defaults to `outputs/<config-stem>/`.

Run every root config:

```bash
python -m swarmfix.run_all_configs configs --output-root outputs
```

After editable install, equivalent console scripts are:

```bash
swarmfix-run configs/04_mission_reference.toml --output-dir outputs/mission_reference
swarmfix-run-all configs --output-root outputs
```

## Run The Live Solver

Start the Python live solve API:

```bash
python -m swarmfix.live.server --host 127.0.0.1 --port 8765
```

After editable install, the console script is:

```bash
swarmfix-live-server --host 127.0.0.1 --port 8765
```

The viewer expects the live API at `http://127.0.0.1:8765` by default.

## Run The Viewer

From `viewer/`:

```bash
npm install
npm run dev
```

The viewer serves the default app and UI catalog through Vite. It loads example
scene JSON from `viewer/public/examples/`, can call the live solver, and exposes
visual diagnostics for GNSS uncertainty, UWB links, residuals, position error,
connection status, and mission action state.

Useful viewer commands:

```bash
npm run test
npm run build
```

## Run Tests

Python tests from the repository root:

```bash
python -m pytest -q tests
```

Expected current result:

```text
112 passed
```

Viewer tests from `viewer/`:

```bash
npm run test -- --run
```

Expected current result:

```text
35 test files passed, 172 tests passed
```

If VS Code shows Python discovery failures, make sure the selected interpreter
is Python 3.11+ and not an older global Python. This repo uses `tomllib`, which
is available in the standard library from Python 3.11 onward.

## Minimal Pipeline Usage

The pipeline entry point is:

```python
from swarmfix.workflow.run_pipeline import run_pipeline

result = run_pipeline("configs/01_square_static.toml")
```

JSON export helpers:

```python
from swarmfix.io.export_scene import export_scene_json, export_solver_trace_json

export_scene_json(result, "outputs/square_static/scene.json")
export_solver_trace_json(result, "outputs/square_static/scene_trace.json")
```

## Repository Layout

```text
configs/              Root TOML scenarios.
experiments/          Reproducible experiment and profiling scripts.
native/               Optional native UWB/GNSS C solver backend.
swarmfix/
    estimation/       Solver backends, fusion, alignment, and bias correction.
    evaluation/       Absolute, relative, orientation, bias, and comparison metrics.
    io/               TOML config loading and JSON export.
    live/             HTTP live-solver API and request models.
    models/           Shared typed data contracts.
    observability/    JSONL events, performance metrics, sinks, and summaries.
    scenarios/        Formation, topology, trajectory, and scenario generation.
    sensors/          GNSS, UWB, and reference simulation.
    visualisation/    Python-side plotting helpers.
    workflow/         End-to-end pipeline orchestration.
tests/                Python pytest suite.
viewer/               Vite/Three.js viewer, UI catalog, and Vitest suite.
```

## Development Notes

The implementation should stay test-first. For behavioural changes, add or
update tests before changing implementation code, run the expected failing test,
then implement the smallest change needed to pass.

Keep generated outputs under `outputs/`, observability logs under `logs/`, and
local planning or agent scratch files under ignored local paths.
