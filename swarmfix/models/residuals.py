"""Residual and solver trace records."""

from __future__ import annotations

from pydantic import BaseModel, Field


class GnssResidual(BaseModel):
    """Residual from current estimate to a GNSS measurement."""

    agent_id: str
    vector: tuple[float, ...]
    norm: float
    weighted_sq: float


class UwbResidual(BaseModel):
    """Residual between current and measured UWB distance."""

    source_id: str
    target_id: str
    residual_m: float
    weighted_sq: float


class ReferenceResidual(BaseModel):
    """Residual from current estimate to a known reference."""

    agent_id: str
    vector: tuple[float, ...]
    norm: float
    weighted_sq: float


class SolverIterationTrace(BaseModel):
    """One recorded solver residual evaluation or accepted iteration."""

    iteration: int
    positions: dict[str, tuple[float, ...]]
    cost_total: float
    cost_gnss: float = 0.0
    cost_uwb: float = 0.0
    cost_reference: float = 0.0
    gnss_residuals: list[GnssResidual] = Field(default_factory=list)
    uwb_residuals: list[UwbResidual] = Field(default_factory=list)
    reference_residuals: list[ReferenceResidual] = Field(default_factory=list)


class SolverTrace(BaseModel):
    """Recorded optimisation states for plotting and viewer export."""

    trace_type: str
    iterations: list[SolverIterationTrace] = Field(default_factory=list)

