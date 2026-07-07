"""TOML configuration loading and validation."""

from __future__ import annotations

import tomllib
from pathlib import Path

from pydantic import BaseModel, Field, model_validator


class ScenarioConfig(BaseModel):
    """Scenario generation config."""

    name: str
    dimension: int
    formation: str
    num_agents: int
    spacing_m: float

    @model_validator(mode="after")
    def validate_config(self) -> ScenarioConfig:
        """Validate static scenario settings."""
        if self.dimension != 2:
            raise ValueError("MVP supports dimension = 2")
        if self.num_agents <= 0:
            raise ValueError("num_agents must be positive")
        if self.spacing_m <= 0.0:
            raise ValueError("spacing_m must be positive")
        return self


class TopologyConfig(BaseModel):
    """Topology graph construction config."""

    mode: str = "full_pairwise"
    max_distance_m: float | None = None

    @model_validator(mode="after")
    def validate_config(self) -> TopologyConfig:
        """Validate topology graph settings."""
        supported_modes = {"full_pairwise", "neighbour"}
        if self.mode not in supported_modes:
            raise ValueError("unsupported topology mode")
        if self.max_distance_m is not None and self.max_distance_m <= 0.0:
            raise ValueError("max_distance_m must be positive")
        return self


class GnssConfig(BaseModel):
    """GNSS sensor config."""

    sigma_m: float
    common_bias_m: tuple[float, ...]
    independent_sigma_m: float = 0.0
    outlier_probability: float = 0.0
    outlier_sigma_m: float = 0.0
    spatial_correlation_enabled: bool = False
    spatial_correlation_length_m: float | None = None
    spatial_correlation_sigma_m: float = 0.0

    @model_validator(mode="after")
    def validate_config(self) -> GnssConfig:
        """Validate GNSS uncertainty settings."""
        if self.sigma_m <= 0.0:
            raise ValueError("gnss sigma_m must be positive")
        if self.independent_sigma_m < 0.0:
            raise ValueError("independent_sigma_m must be non-negative")
        if not 0.0 <= self.outlier_probability <= 1.0:
            raise ValueError("outlier_probability must be between 0 and 1")
        if self.outlier_sigma_m < 0.0:
            raise ValueError("outlier_sigma_m must be non-negative")
        if self.outlier_probability > 0.0 and self.outlier_sigma_m <= 0.0:
            raise ValueError("outlier_sigma_m must be positive when outliers are enabled")
        if self.spatial_correlation_sigma_m < 0.0:
            raise ValueError("spatial_correlation_sigma_m must be non-negative")
        if self.spatial_correlation_enabled:
            if self.spatial_correlation_length_m is None:
                raise ValueError("spatial_correlation_length_m is required")
            if self.spatial_correlation_length_m <= 0.0:
                raise ValueError("spatial_correlation_length_m must be positive")
        return self


class UwbConfig(BaseModel):
    """UWB sensor config."""

    enabled: bool = True
    sigma_m: float
    max_range_m: float | None = None
    missing_link_probability: float = 0.0
    nlos_probability: float = 0.0
    nlos_positive_bias_m: float = 0.0

    @model_validator(mode="after")
    def validate_config(self) -> UwbConfig:
        """Validate UWB uncertainty settings."""
        if self.sigma_m <= 0.0:
            raise ValueError("uwb sigma_m must be positive")
        if self.max_range_m is not None and self.max_range_m <= 0.0:
            raise ValueError("uwb max_range_m must be positive")
        if not 0.0 <= self.missing_link_probability <= 1.0:
            raise ValueError("missing_link_probability must be between 0 and 1")
        if not 0.0 <= self.nlos_probability <= 1.0:
            raise ValueError("nlos_probability must be between 0 and 1")
        if self.nlos_positive_bias_m < 0.0:
            raise ValueError("nlos_positive_bias_m must be non-negative")
        return self


class ReferenceConfig(BaseModel):
    """Mission reference config."""

    enabled: bool = False
    type: str = "known_agent_position"
    agent_id: str | None = None
    position_m: tuple[float, ...] | None = None
    sigma_m: float | None = None


class EstimationConfig(BaseModel):
    """Estimator config."""

    method: str = "least_squares"
    robust_loss: str = "linear"
    export_solver_trace: bool = True
    max_iterations: int = Field(default=100, ge=1)

    @model_validator(mode="after")
    def validate_config(self) -> EstimationConfig:
        """Validate estimator selection settings."""
        if self.method != "least_squares":
            raise ValueError("method must be least_squares")
        supported_losses = {"linear", "soft_l1", "huber", "cauchy", "arctan"}
        if self.robust_loss not in supported_losses:
            raise ValueError("unsupported robust_loss")
        return self


class SwarmFixConfig(BaseModel):
    """Validated SwarmFix pipeline config."""

    seed: int = 0
    scenario: ScenarioConfig
    topology: TopologyConfig = Field(default_factory=TopologyConfig)
    gnss: GnssConfig
    uwb: UwbConfig
    reference: ReferenceConfig = Field(default_factory=ReferenceConfig)
    estimation: EstimationConfig = Field(default_factory=EstimationConfig)

    @model_validator(mode="after")
    def validate_config(self) -> SwarmFixConfig:
        """Validate cross-section vector lengths."""
        if len(self.gnss.common_bias_m) != self.scenario.dimension:
            raise ValueError("gnss common_bias_m must match scenario dimension")
        if self.reference.position_m is not None:
            if len(self.reference.position_m) != self.scenario.dimension:
                raise ValueError("reference position_m must match scenario dimension")
        return self


def load_config(path: str | Path) -> SwarmFixConfig:
    """Load and validate a TOML SwarmFix config file."""
    config_path = Path(path)
    with config_path.open("rb") as config_file:
        raw_config = tomllib.load(config_file)
    config = SwarmFixConfig.model_validate(raw_config)
    return config
