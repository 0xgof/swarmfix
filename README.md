# SwarmFix

SwarmFix is a proof-of-concept Python package for cooperative GNSS/UWB
localisation in swarms of drones, robots, or mobile agents.

The project explores whether a swarm with noisy absolute GNSS measurements and
more accurate inter-agent UWB range measurements can improve localisation by
constraining the swarm geometry.

## Current Scope

The current implementation covers a static 2D MVP:

- typed scenario, measurement, estimate, residual, metric, and result records;
- square and grid formation generation;
- full-pairwise and neighbour topology graph generation;
- GNSS simulation with common bias and independent noise;
- UWB range simulation;
- optional mission reference measurements;
- GNSS-only baseline estimation;
- rigid topology alignment;
- weighted GNSS/UWB least-squares fusion;
- mission-level translation bias correction;
- absolute and relative evaluation metrics;
- TOML config loading with Pydantic validation;
- end-to-end pipeline orchestration;
- JSON scene and solver-trace export;
- Python-side plotting helpers.

The Three.js viewer is planned but not implemented yet.

## Key Limitation

UWB/topology constraints can improve relative formation geometry and reduce
non-common GNSS error. They cannot remove a pure common translation bias of the
whole swarm without an absolute reference such as RTK, fixed anchors, landmarks,
or a known mission reference point.

## Requirements

Use Python 3.11 or newer. The repo has been tested with:

```text
Python 3.12.7
pytest 7.4.4
```

The package depends on:

- matplotlib
- numpy
- pydantic
- scipy

## Run The Program

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

## Run Tests

From the repository root:

```bash
python -m pytest -q tests
```

Expected current result:

```text
40 passed
```

If VS Code shows discovery failures, make sure the selected interpreter is
Python 3.11+ and not an older global Python. This repo uses `tomllib`, which is
available in the standard library from Python 3.11 onward.

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
swarmfix/
    estimation/       GNSS-only, rigid topology, fusion, and bias correction.
    evaluation/       Absolute and relative metrics.
    io/               TOML config loading and JSON export.
    models/           Shared typed data contracts.
    scenarios/        Formation and topology generation.
    sensors/          GNSS, UWB, and reference simulation.
    visualisation/    Python-side plotting helpers.
    workflow/         End-to-end pipeline orchestration.

tests/                Module-focused pytest suite.
```

## Development Notes

The implementation should stay test-first. For behavioural changes, add or
update tests before changing implementation code, run the expected failing test,
then implement the smallest change needed to pass.

Keep generated outputs under `outputs/`. That directory is ignored by Git.
