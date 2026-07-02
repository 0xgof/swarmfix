"""Pipeline result persistence helpers."""

from __future__ import annotations

from pathlib import Path

from swarmfix.io.export_scene import export_scene_json
from swarmfix.models.results import PipelineResult


def write_pipeline_result(result: PipelineResult, output_path: str | Path) -> None:
    """Persist a pipeline result as JSON-safe scene data."""
    export_scene_json(result, output_path)
