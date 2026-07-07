"""Public pipeline entry point."""

from __future__ import annotations

from pathlib import Path

from swarmfix.io.config import load_config
from swarmfix.models.results import PipelineResult
from swarmfix.workflow.steps import build_pipeline_result


def run_pipeline(config_path: str | Path) -> PipelineResult:
    """Run the SwarmFix pipeline from a TOML config path."""
    config = load_config(config_path)
    pipeline_result = build_pipeline_result(config)
    return pipeline_result

