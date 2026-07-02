"""Evaluation metric records."""

from __future__ import annotations

from pydantic import BaseModel, Field


class MetricsSummary(BaseModel):
    """Metric values for one estimate method."""

    method: str
    values: dict[str, float] = Field(default_factory=dict)

