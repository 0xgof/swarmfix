"""Typed request and response records for live viewer solving."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from swarmfix.observability.events import TraceContext


class LiveAgentState(BaseModel):
    """Current true or simulated agent state supplied by the live viewer."""

    agent_id: str
    position_m: tuple[float, ...]


class LiveGnssMeasurement(BaseModel):
    """Live absolute position measurement for one agent."""

    agent_id: str
    position_m: tuple[float, ...]
    sigma_m: float

    @model_validator(mode="after")
    def validate_measurement(self) -> LiveGnssMeasurement:
        """Reject non-positive GNSS uncertainty."""
        if self.sigma_m <= 0.0:
            raise ValueError("GNSS sigma_m must be positive")
        return self


class LiveUwbMeasurement(BaseModel):
    """Live UWB range measurement between two agents."""

    source_id: str
    target_id: str
    distance_m: float
    sigma_m: float
    true_distance_m: float | None = None

    @model_validator(mode="after")
    def validate_measurement(self) -> LiveUwbMeasurement:
        """Reject impossible range measurements."""
        if self.source_id == self.target_id:
            raise ValueError("UWB source and target cannot be identical")
        if self.distance_m <= 0.0:
            raise ValueError("UWB distance_m must be positive")
        if self.sigma_m <= 0.0:
            raise ValueError("UWB sigma_m must be positive")
        return self


class SelectedUwbLink(BaseModel):
    """Undirected UWB link selected by the viewer controls."""

    source_id: str
    target_id: str

    @model_validator(mode="after")
    def validate_link(self) -> SelectedUwbLink:
        """Reject self-links because they cannot constrain position."""
        if self.source_id == self.target_id:
            raise ValueError("selected UWB source and target cannot be identical")
        return self


class LiveEstimationOptions(BaseModel):
    """Solver options that are safe to expose through the live viewer."""

    max_iterations: int = 100
    robust_loss: Literal["linear", "soft_l1", "huber", "cauchy", "arctan"] = "linear"

    @model_validator(mode="after")
    def validate_options(self) -> LiveEstimationOptions:
        """Reject solver settings that would make live solves unsafe."""
        if self.max_iterations <= 0:
            raise ValueError("max_iterations must be positive")
        return self


class LiveSolveRequest(BaseModel):
    """Complete live solve request sent from the viewer to Python."""

    schema_version: str = "0.1.0"
    dimension: int
    agents: list[LiveAgentState]
    gnss: list[LiveGnssMeasurement]
    uwb: list[LiveUwbMeasurement] = Field(default_factory=list)
    selected_uwb_links: list[SelectedUwbLink] | None = None
    estimation: LiveEstimationOptions = Field(default_factory=LiveEstimationOptions)
    trace_context: TraceContext | None = None

    @model_validator(mode="after")
    def validate_request_shape(self) -> LiveSolveRequest:
        """Reject invalid high-level request dimensions."""
        if self.dimension <= 0:
            raise ValueError("dimension must be positive")
        return self


class LivePositionEstimate(BaseModel):
    """Estimated live position for one agent."""

    agent_id: str
    position_m: tuple[float, ...]


class LiveEstimateSection(BaseModel):
    """Named live estimate sets returned by Python."""

    fused: list[LivePositionEstimate]
    gnss_only: list[LivePositionEstimate]


class LiveTraceIteration(BaseModel):
    """Serializable solver trace state for a live solve."""

    iteration: int
    positions: dict[str, tuple[float, ...]]
    cost_total: float
    cost_gnss: float
    cost_uwb: float
    gnss_residuals: list[dict[str, object]] = Field(default_factory=list)
    uwb_residuals: list[dict[str, object]] = Field(default_factory=list)


class LiveTraceSection(BaseModel):
    """Serializable live solver trace."""

    trace_type: str
    iterations: list[LiveTraceIteration] = Field(default_factory=list)


class LiveConstraintNode(BaseModel):
    """Per-agent UWB constraint state without implying a UWB-only position."""

    agent_id: str
    selected_uwb_degree: int
    constraint_state: Literal["no_uwb", "weak_uwb", "multi_uwb"]
    graph_support: Literal["none", "weak_range", "chain", "triangle", "graph"] = "none"


class LiveConstraintEdge(BaseModel):
    """One live UWB distance constraint and its latest residual."""

    source_id: str
    target_id: str
    measured_distance_m: float
    sigma_m: float
    residual_m: float | None = None
    weighted_sq: float | None = None
    measurement_type: Literal["distance_constraint"] = "distance_constraint"


class LiveConstraintSection(BaseModel):
    """UWB constraint graph returned to the viewer."""

    nodes: list[LiveConstraintNode]
    edges: list[LiveConstraintEdge]

    def nodes_by_agent(self, agent_id: str) -> LiveConstraintNode:
        """Return one constraint node by agent id."""
        for node in self.nodes:
            if node.agent_id == agent_id:
                return node
        raise KeyError(f"unknown constraint agent_id: {agent_id}")


class LiveSolveMetadata(BaseModel):
    """Metadata describing how the live solve response was produced."""

    solver: str
    selected_uwb_count: int
    trace_context: dict[str, object] | None = None


class LiveSolveResponse(BaseModel):
    """Authoritative live solver response consumed by the viewer."""

    schema_version: str
    metadata: LiveSolveMetadata
    truth: list[LiveAgentState]
    measurements: dict[str, list[dict[str, object]]]
    estimates: LiveEstimateSection
    trace: LiveTraceSection
    constraints: LiveConstraintSection
