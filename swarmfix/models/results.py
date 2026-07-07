"""Pipeline result records."""

from __future__ import annotations

from pydantic import BaseModel, Field

from swarmfix.models.estimates import EstimateSet
from swarmfix.models.measurements import MeasurementSet
from swarmfix.models.metrics import MetricsSummary
from swarmfix.models.residuals import SolverTrace
from swarmfix.models.scenario import Scenario


class PipelineResult(BaseModel):
    """Complete in-memory output from a SwarmFix pipeline run."""

    scenario: Scenario
    measurements: MeasurementSet
    estimates: dict[str, EstimateSet]
    metrics: dict[str, MetricsSummary] = Field(default_factory=dict)
    solver_trace: SolverTrace | None = None


class ExperimentResult(BaseModel):
    """Named experiment wrapper around a pipeline result."""

    name: str
    pipeline_result: PipelineResult
