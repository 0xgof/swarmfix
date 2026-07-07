"""Typed request and response records for live viewer solving."""

from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from swarmfix.observability.events import TraceContext
from swarmfix.scenarios.mission_actions import (
    FormationMode,
    MissionActionOption,
    MissionActionState,
    MotionMode,
)


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


class MissionActionCatalogResponse(BaseModel):
    """Catalog response for viewer mission-action controls."""

    schema_version: str = "0.1.0"
    formations: list[MissionActionOption]
    motions: list[MissionActionOption]


class MissionActionPositionsRequest(BaseModel):
    """Request for mission-action positions without sensor or solver output."""

    agent_ids: list[str]
    time_s: float
    mission_action: MissionActionState = Field(default_factory=MissionActionState)

    @model_validator(mode="after")
    def validate_request_shape(self) -> MissionActionPositionsRequest:
        """Reject invalid position-generation requests."""
        if not self.agent_ids:
            raise ValueError("agent_ids must not be empty")
        if not math.isfinite(self.time_s):
            raise ValueError("time_s must be finite")
        if any(not agent_id for agent_id in self.agent_ids):
            raise ValueError("agent_ids must not contain blank ids")
        return self


class MissionActionPosition(BaseModel):
    """One generated mission-action position."""

    agent_id: str
    position_m: tuple[float, ...]


class MissionActionPositionsMetadata(BaseModel):
    """Metadata for mission-action position generation."""

    formation: FormationMode
    motion: MotionMode
    time_s: float


class MissionActionPositionsResponse(BaseModel):
    """Positions-only response for backend mission actions."""

    schema_version: str = "0.1.0"
    metadata: MissionActionPositionsMetadata
    positions: list[MissionActionPosition]


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


class LiveErrorSummary(BaseModel):
    """Aggregate position-error metrics for one comparable solve snapshot."""

    rmse_m: float
    mean_error_m: float
    max_error_m: float


class LiveSolveQualitySummary(BaseModel):
    """Compact solve-quality summary for observability and viewer diagnostics."""

    solve_error: LiveErrorSummary
    gnss_truth_error: LiveErrorSummary
    solve_improvement_rmse_m: float
    solve_error_ratio_to_gnss: float | None
    fused_worse_than_gnss: bool
    final_cost_total: float | None = None
    final_cost_gnss: float | None = None
    final_cost_uwb: float | None = None


class LiveSolveMetadata(BaseModel):
    """Metadata describing how the live solve response was produced."""

    solver: str
    selected_uwb_count: int
    trace_context: dict[str, object] | None = None
    quality: LiveSolveQualitySummary | None = None


class LiveSolveResponse(BaseModel):
    """Authoritative live solver response consumed by the viewer."""

    schema_version: str
    metadata: LiveSolveMetadata
    truth: list[LiveAgentState]
    measurements: dict[str, list[dict[str, object]]]
    estimates: LiveEstimateSection
    trace: LiveTraceSection
    constraints: LiveConstraintSection


class LiveSensorOptions(BaseModel):
    """Sensor policy inputs for backend-owned live frames.

    The current viewer derives per-agent GNSS offsets and GNSS/UWB sigmas
    from the exported scene trace. During migration the viewer sends those
    derived values here; agents or links absent from the maps use the
    fallback sigma and the deterministic hash-based fallback offset.

    ``uwb_sigma_m_by_link`` keys are stable undirected endpoint keys in the
    form ``"<first_id>::<second_id>"`` with lexicographically sorted ids.
    """

    gnss_offset_m_by_agent: dict[str, tuple[float, float, float]] = Field(
        default_factory=dict
    )
    gnss_sigma_m_by_agent: dict[str, float] = Field(default_factory=dict)
    uwb_sigma_m_by_link: dict[str, float] = Field(default_factory=dict)
    gnss_fallback_sigma_m: float = 1.0
    uwb_fallback_sigma_m: float = 0.1

    @model_validator(mode="after")
    def validate_sigmas(self) -> LiveSensorOptions:
        """Reject non-positive uncertainty values anywhere in the policy."""
        if self.gnss_fallback_sigma_m <= 0.0:
            raise ValueError("gnss_fallback_sigma_m must be a positive sigma")
        if self.uwb_fallback_sigma_m <= 0.0:
            raise ValueError("uwb_fallback_sigma_m must be a positive sigma")
        for agent_id, sigma_m in self.gnss_sigma_m_by_agent.items():
            if sigma_m <= 0.0:
                raise ValueError(f"GNSS sigma for {agent_id} must be a positive sigma")
        for link_key, sigma_m in self.uwb_sigma_m_by_link.items():
            if sigma_m <= 0.0:
                raise ValueError(f"UWB sigma for {link_key} must be a positive sigma")
        return self


class LiveSelectionOptions(BaseModel):
    """UWB link-selection options plus viewer-echoed hysteresis state.

    ``previous_selected_links`` is state transport, not selection authority:
    the viewer echoes the backend's previously selected links so retention,
    add/drop hysteresis, and the graph-change budget work across stateless
    requests. The backend selector still decides which links survive.

    ``previous_estimate`` is the fused estimate from the viewer's previous
    frame. Selection geometry (range gates, ranking, and the angle gate) must
    never use ground truth -- in reality truth is unknown -- so the backend
    selects from this estimate when present and from the GNSS baseline
    otherwise. Sensor values (GNSS, UWB ranges) still derive from truth; the
    firewall applies only to solution-shaping geometry.

    Unset ranges preserve the current viewer defaults: unbounded max range,
    add range equal to max range, and drop range at 1.1 times max range.
    """

    max_range_m: float | None = None
    add_range_m: float | None = None
    drop_range_m: float | None = None
    max_graph_changes_per_frame: int = 2
    min_link_separation_deg: float = 10.0
    previous_selected_links: list[SelectedUwbLink] = Field(default_factory=list)
    previous_estimate: list[LivePositionEstimate] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_options(self) -> LiveSelectionOptions:
        """Reject negative ranges, budgets, and angular separations."""
        if self.max_range_m is not None and self.max_range_m < 0.0:
            raise ValueError("max_range_m must be a non-negative range")
        if self.add_range_m is not None and self.add_range_m < 0.0:
            raise ValueError("add_range_m must be a non-negative range")
        if self.drop_range_m is not None and self.drop_range_m < 0.0:
            raise ValueError("drop_range_m must be a non-negative range")
        if self.max_graph_changes_per_frame < 0:
            raise ValueError("max_graph_changes_per_frame must be non-negative")
        if self.min_link_separation_deg < 0.0:
            raise ValueError("min_link_separation_deg separation must be non-negative")
        return self


class LiveFrameEstimationOptions(LiveEstimationOptions):
    """Estimation options whose defaults match current viewer live solves.

    The viewer hardcodes 40 iterations with linear loss when assembling
    ``/solve`` requests today. Live frames must keep that behavior instead
    of silently adopting the 100-iteration ``LiveEstimationOptions`` default.
    """

    max_iterations: int = 40


class LiveFrameRequest(BaseModel):
    """Mission intent and options for one backend-owned live frame.

    Unlike ``LiveSolveRequest``, this request carries no measurements. The
    backend builds truth, GNSS, and UWB data itself and returns the complete
    render-ready frame in a ``LiveFrameResponse``.
    """

    schema_version: str = "0.1.0"
    agent_ids: list[str]
    time_s: float
    mission_action: MissionActionState = Field(default_factory=MissionActionState)
    max_uwb_links_per_agent: int
    sensor_options: LiveSensorOptions = Field(default_factory=LiveSensorOptions)
    selection_options: LiveSelectionOptions = Field(
        default_factory=LiveSelectionOptions
    )
    estimation: LiveFrameEstimationOptions = Field(
        default_factory=LiveFrameEstimationOptions
    )
    trace_context: TraceContext | None = None

    @model_validator(mode="after")
    def validate_request_shape(self) -> LiveFrameRequest:
        """Reject malformed live-frame intent before frame building starts."""
        if not self.agent_ids:
            raise ValueError("agent_ids must not be empty")
        if any(not agent_id for agent_id in self.agent_ids):
            raise ValueError("agent_ids must not contain blank ids")
        if len(set(self.agent_ids)) != len(self.agent_ids):
            raise ValueError("agent_ids must not contain duplicate ids")
        if not math.isfinite(self.time_s):
            raise ValueError("time_s must be finite")
        if self.max_uwb_links_per_agent < 0:
            raise ValueError("max_uwb_links_per_agent must be non-negative")
        return self


class LiveSelectedUwbLink(BaseModel):
    """Backend-selected UWB link with render-ready range data."""

    source_id: str
    target_id: str
    measured_distance_m: float
    sigma_m: float
    selection_reason: Literal["retained", "new"]

    @model_validator(mode="after")
    def validate_link(self) -> LiveSelectedUwbLink:
        """Reject links that cannot constrain position."""
        if self.source_id == self.target_id:
            raise ValueError("selected UWB source and target cannot be identical")
        if self.measured_distance_m <= 0.0:
            raise ValueError("measured distance must be positive")
        if self.sigma_m <= 0.0:
            raise ValueError("selected UWB sigma_m must be a positive sigma")
        return self


class LiveUwbSelectionDiagnostics(BaseModel):
    """Diagnostics describing one backend UWB selection pass.

    Field meanings mirror the viewer's adaptive selector diagnostics so
    existing panels and observability keep working after the migration.
    """

    candidate_link_count: int
    selected_link_count: int
    max_links_per_agent: int
    connected_component_count: int
    isolated_agent_count: int
    triangle_count: int
    added_links: int
    dropped_links: int
    selection_policy: str = "adaptive_range_graph_v1"
    adaptive_selection_enabled: bool = True


class LiveFrameMeasurementSection(BaseModel):
    """Typed GNSS and UWB measurements carried by a live-frame response."""

    gnss: list[LiveGnssMeasurement]
    uwb: list[LiveUwbMeasurement]


class LiveFrameMetadata(BaseModel):
    """Metadata describing how a backend live frame was produced."""

    solver: str
    formation: FormationMode
    motion: MotionMode
    time_s: float
    selected_uwb_count: int
    trace_context: dict[str, object] | None = None


class LiveFrameResponse(BaseModel):
    """Complete render-ready live frame returned by the backend.

    Carries everything the viewer needs to render truth, measurements, UWB
    cords, estimates, residuals, constraints, and quality without generating
    any solver evidence locally.
    """

    schema_version: str
    metadata: LiveFrameMetadata
    truth: list[LiveAgentState]
    measurements: LiveFrameMeasurementSection
    selected_uwb_links: list[LiveSelectedUwbLink]
    uwb_selection: LiveUwbSelectionDiagnostics
    estimates: LiveEstimateSection
    trace: LiveTraceSection
    constraints: LiveConstraintSection
    quality: LiveSolveQualitySummary | None = None
