"""Noise model metadata records."""

from __future__ import annotations

from pydantic import BaseModel, model_validator


class GnssNoiseModel(BaseModel):
    """GNSS noise settings used to generate measurements."""

    sigma_m: float
    common_bias_m: tuple[float, ...]
    independent_sigma_m: float

    @model_validator(mode="after")
    def validate_noise_model(self) -> GnssNoiseModel:
        """Validate GNSS uncertainty values."""
        if self.sigma_m <= 0.0:
            raise ValueError("GNSS sigma_m must be positive")
        if self.independent_sigma_m < 0.0:
            raise ValueError("independent_sigma_m must be non-negative")
        return self


class UwbNoiseModel(BaseModel):
    """UWB noise settings used to generate measurements."""

    sigma_m: float
    max_range_m: float | None = None

    @model_validator(mode="after")
    def validate_noise_model(self) -> UwbNoiseModel:
        """Validate UWB uncertainty values."""
        if self.sigma_m <= 0.0:
            raise ValueError("UWB sigma_m must be positive")
        if self.max_range_m is not None and self.max_range_m <= 0.0:
            raise ValueError("max_range_m must be positive")
        return self
