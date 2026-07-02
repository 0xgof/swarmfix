"""Estimator-facing measurement records."""

from __future__ import annotations

from pydantic import BaseModel, Field, model_validator


class GnssMeasurement(BaseModel):
    """Noisy absolute position measurement for one agent."""

    agent_id: str
    position_m: tuple[float, ...]
    sigma_m: float

    @model_validator(mode="after")
    def validate_measurement(self) -> GnssMeasurement:
        """Validate declared uncertainty."""
        if self.sigma_m <= 0.0:
            raise ValueError("GNSS sigma_m must be positive")
        return self


class UwbRangeMeasurement(BaseModel):
    """Pairwise UWB range measurement between two agents."""

    source_id: str
    target_id: str
    distance_m: float
    sigma_m: float
    true_distance_m: float | None = None

    @model_validator(mode="after")
    def validate_measurement(self) -> UwbRangeMeasurement:
        """Validate endpoints and uncertainty."""
        if self.source_id == self.target_id:
            raise ValueError("UWB source and target cannot be identical")
        if self.distance_m <= 0.0:
            raise ValueError("UWB distance_m must be positive")
        if self.sigma_m <= 0.0:
            raise ValueError("UWB sigma_m must be positive")
        return self


class ReferenceMeasurement(BaseModel):
    """Known absolute position reference for one agent."""

    agent_id: str
    position_m: tuple[float, ...]
    sigma_m: float | None = None

    @model_validator(mode="after")
    def validate_measurement(self) -> ReferenceMeasurement:
        """Validate optional reference uncertainty."""
        if self.sigma_m is not None and self.sigma_m <= 0.0:
            raise ValueError("reference sigma_m must be positive")
        return self


class MeasurementSet(BaseModel):
    """All measurements for one scenario run."""

    gnss: list[GnssMeasurement] = Field(default_factory=list)
    uwb: list[UwbRangeMeasurement] = Field(default_factory=list)
    references: list[ReferenceMeasurement] = Field(default_factory=list)

