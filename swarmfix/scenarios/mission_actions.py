"""Backend-authoritative formation and motion generation."""

from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


FormationMode = Literal[
    "grid",
    "line",
    "column",
    "wedge",
    "ring",
    "square_patrol",
    "random_cloud",
]
MotionMode = Literal["static", "random_walk", "forward", "path_follow"]
PathMode = Literal["loop", "waypoints"]
GeometryRisk = Literal["low", "medium", "high"]
Position3D = tuple[float, float, float]

DEFAULT_SPACING_M = 3.0
DEFAULT_PATH_RADIUS_M = 8.0
DEFAULT_PATH_PERIOD_S = 18.0
FNV_OFFSET_BASIS = 2166136261
FNV_PRIME = 16777619
UINT32_MAX = 0xFFFFFFFF


class MissionActionOption(BaseModel):
    """Catalog entry for one mission action option."""

    model_config = ConfigDict(frozen=True)

    id: str
    label: str
    description: str
    parameters: list[str] = Field(default_factory=list)
    geometry_traits: list[str] = Field(default_factory=list)
    solver_geometry_risk: GeometryRisk = "low"


class MissionActionCatalog(BaseModel):
    """Supported backend mission action modes."""

    model_config = ConfigDict(frozen=True)

    formations: list[MissionActionOption]
    motions: list[MissionActionOption]


class MissionActionState(BaseModel):
    """Formation and motion intent used to generate backend truth positions."""

    formation: FormationMode = "grid"
    motion: MotionMode = "random_walk"
    spacing_m: float = DEFAULT_SPACING_M
    speed_mps: float = 1.0
    random_walk_amplitude_m: float = 0.24
    path: PathMode = "loop"
    previous_formation: FormationMode | None = None
    transition_started_at_s: float | None = None
    transition_duration_s: float = 2.0

    @model_validator(mode="after")
    def validate_state(self) -> MissionActionState:
        """Reject invalid action settings before truth generation."""
        if self.spacing_m <= 0.0:
            raise ValueError("spacing_m must be positive")
        if self.speed_mps < 0.0:
            raise ValueError("speed_mps must be non-negative")
        if self.random_walk_amplitude_m < 0.0:
            raise ValueError("random_walk_amplitude_m must be non-negative")
        if self.transition_duration_s <= 0.0:
            raise ValueError("transition_duration_s must be positive")
        return self


def _stable_unit(agent_id: str,
                 salt: int) -> float:
    """Return deterministic pseudo-random unit value for an agent id."""
    key = f"{salt}:{agent_id}"
    hash_value = (FNV_OFFSET_BASIS ^ salt) & UINT32_MAX
    for character in key:
        hash_value = hash_value ^ ord(character)
        hash_value = (hash_value * FNV_PRIME) & UINT32_MAX

    hash_value = hash_value ^ (hash_value >> 16)
    hash_value = (hash_value * 2246822519) & UINT32_MAX
    hash_value = hash_value ^ (hash_value >> 13)
    hash_value = (hash_value * 3266489917) & UINT32_MAX
    hash_value = hash_value ^ (hash_value >> 16)

    unit_value = hash_value / UINT32_MAX
    return unit_value


def _ordered_agent_ids(agent_ids: list[str]) -> list[str]:
    """Return a stable natural-ish order for agent identifiers."""
    ordered_ids = sorted(agent_ids, key=_agent_sort_key)
    return ordered_ids


def _agent_sort_key(agent_id: str) -> tuple[str, int, str]:
    """Sort ids with numeric suffixes in numeric order."""
    prefix = agent_id.rstrip("0123456789")
    suffix = agent_id[len(prefix):]
    suffix_value = int(suffix) if suffix else -1
    key = (prefix, suffix_value, agent_id)
    return key


def _centered_index(index: int,
                    count: int) -> float:
    """Return index centered around zero for a sequence length."""
    centered = index - (count - 1) / 2.0
    return centered


def _grid_offset(index: int,
                 count: int,
                 spacing_m: float) -> Position3D:
    """Return row-major grid offset."""
    columns = math.ceil(math.sqrt(count))
    rows = math.ceil(count / columns)
    column = index % columns
    row = index // columns
    x = (column - (columns - 1) / 2.0) * spacing_m
    z = (row - (rows - 1) / 2.0) * spacing_m
    offset = (x, 0.0, z)
    return offset


def _line_offset(index: int,
                 count: int,
                 spacing_m: float) -> Position3D:
    """Return x-axis line offset."""
    offset = (_centered_index(index, count) * spacing_m, 0.0, 0.0)
    return offset


def _column_offset(index: int,
                   count: int,
                   spacing_m: float) -> Position3D:
    """Return z-axis column offset."""
    offset = (0.0, 0.0, _centered_index(index, count) * spacing_m)
    return offset


def _wedge_offset(index: int,
                  spacing_m: float) -> Position3D:
    """Return two-arm wedge offset."""
    if index == 0:
        return (0.0, 0.0, 0.0)

    rank = math.ceil(index / 2.0)
    side = 1.0 if index % 2 == 0 else -1.0
    offset = (side * rank * spacing_m, 0.0, -rank * spacing_m)
    return offset


def _ring_offset(index: int,
                 count: int,
                 spacing_m: float) -> Position3D:
    """Return circular ring offset."""
    radius_m = max(spacing_m, count * spacing_m / (math.pi * 2.0))
    angle = (math.pi * 2.0 * index) / max(1, count)
    offset = (math.cos(angle) * radius_m, 0.0, math.sin(angle) * radius_m)
    return offset


def _random_cloud_offset(agent_id: str,
                         spacing_m: float) -> Position3D:
    """Return deterministic pseudo-random cloud offset."""
    radius_m = spacing_m * (0.8 + _stable_unit(agent_id, 17) * 1.6)
    angle = _stable_unit(agent_id, 29) * math.pi * 2.0
    height_m = (_stable_unit(agent_id, 43) - 0.5) * spacing_m * 0.35
    offset = (math.cos(angle) * radius_m, height_m, math.sin(angle) * radius_m)
    return offset


def _square_patrol_offset(agent_id: str,
                          index: int,
                          count: int,
                          spacing_m: float) -> Position3D:
    """Return four square corners plus deterministic interior rover slots."""
    if count < 5:
        raise ValueError("square_patrol formation requires at least 5 agents")

    square_corners = [
        (-spacing_m, 0.0, -spacing_m),
        (spacing_m, 0.0, -spacing_m),
        (spacing_m, 0.0, spacing_m),
        (-spacing_m, 0.0, spacing_m),
    ]
    if index < len(square_corners):
        return square_corners[index]

    interior_scale = spacing_m * 0.55
    x = (_stable_unit(agent_id, 97) - 0.5) * interior_scale * 2.0
    z = (_stable_unit(agent_id, 109) - 0.5) * interior_scale * 2.0
    y = (_stable_unit(agent_id, 113) - 0.5) * spacing_m * 0.2
    offset = (x, y, z)
    return offset


def _add_position(a: Position3D,
                  b: Position3D) -> Position3D:
    """Add two 3D positions."""
    position = (a[0] + b[0], a[1] + b[1], a[2] + b[2])
    return position


def _interpolate_position(a: Position3D,
                          b: Position3D,
                          progress: float) -> Position3D:
    """Interpolate between two positions with clamped progress."""
    clamped_progress = min(1.0, max(0.0, progress))
    position = (
        a[0] + (b[0] - a[0]) * clamped_progress,
        a[1] + (b[1] - a[1]) * clamped_progress,
        a[2] + (b[2] - a[2]) * clamped_progress,
    )
    return position


def _random_walk_offset(agent_id: str,
                        time_seconds: float,
                        amplitude_m: float) -> Position3D:
    """Return deterministic bounded drift around a formation slot."""
    phase = _stable_unit(agent_id, 71) * math.pi * 2.0
    x = math.sin(time_seconds * 0.55 + phase) * amplitude_m
    y = math.sin(time_seconds * 0.41 + phase * 1.7) * amplitude_m * 0.25
    z = math.cos(time_seconds * 0.49 + phase * 1.3) * amplitude_m
    offset = (x, y, z)
    return offset


def _clamp(value: float,
           lower_bound: float,
           upper_bound: float) -> float:
    """Clamp a scalar into an inclusive range."""
    clamped_value = min(upper_bound, max(lower_bound, value))
    return clamped_value


def _square_patrol_random_walk_offset(agent_id: str,
                                      formation_offset: Position3D,
                                      time_seconds: float,
                                      amplitude_m: float,
                                      spacing_m: float) -> Position3D:
    """Return drift that keeps an interior rover inside the square."""
    raw_drift = _random_walk_offset(agent_id, time_seconds, amplitude_m)
    candidate_x = _clamp(formation_offset[0] + raw_drift[0], -spacing_m, spacing_m)
    candidate_z = _clamp(formation_offset[2] + raw_drift[2], -spacing_m, spacing_m)
    drift = (
        candidate_x - formation_offset[0],
        raw_drift[1],
        candidate_z - formation_offset[2],
    )
    return drift


def mission_action_catalog() -> MissionActionCatalog:
    """Return the backend mission-action catalog for API and UI clients."""
    formations = [
        MissionActionOption(
            id="grid",
            label="grid",
            description="Row-major grid formation.",
            geometry_traits=["planar", "bounded"],
            solver_geometry_risk="low",
        ),
        MissionActionOption(
            id="line",
            label="line",
            description="Collinear formation across the x axis.",
            geometry_traits=["planar", "collinear"],
            solver_geometry_risk="high",
        ),
        MissionActionOption(
            id="column",
            label="column",
            description="Collinear formation along the z axis.",
            geometry_traits=["planar", "collinear"],
            solver_geometry_risk="high",
        ),
        MissionActionOption(
            id="wedge",
            label="wedge",
            description="Two trailing arms behind a lead agent.",
            geometry_traits=["planar", "bounded"],
            solver_geometry_risk="medium",
        ),
        MissionActionOption(
            id="ring",
            label="ring",
            description="Agents distributed around a circle.",
            geometry_traits=["planar", "supports_closed_loops"],
            solver_geometry_risk="low",
        ),
        MissionActionOption(
            id="square_patrol",
            label="square patrol",
            description="Four corner agents hold a square while additional agents roam inside.",
            parameters=["random_walk_amplitude_m"],
            geometry_traits=["planar", "bounded", "requires_5_agents"],
            solver_geometry_risk="low",
        ),
        MissionActionOption(
            id="random_cloud",
            label="random cloud",
            description="Deterministic pseudo-random offsets from agent ids.",
            geometry_traits=["bounded", "stochastic_deterministic"],
            solver_geometry_risk="medium",
        ),
    ]
    motions = [
        MissionActionOption(
            id="static",
            label="static",
            description="Hold the formation center fixed.",
        ),
        MissionActionOption(
            id="random_walk",
            label="random walk",
            description="Apply bounded deterministic per-agent drift.",
            parameters=["random_walk_amplitude_m"],
        ),
        MissionActionOption(
            id="forward",
            label="forward",
            description="Translate the formation center along the x axis.",
            parameters=["speed_mps"],
        ),
        MissionActionOption(
            id="path_follow",
            label="path follow",
            description="Move the formation center along a repeatable loop.",
            parameters=["path"],
        ),
    ]
    catalog = MissionActionCatalog(formations=formations, motions=motions)
    return catalog


def formation_offsets(agent_ids: list[str],
                      formation: FormationMode,
                      spacing_m: float = DEFAULT_SPACING_M) -> dict[str, Position3D]:
    """Return deterministic formation offsets keyed by agent id."""
    if spacing_m <= 0.0:
        raise ValueError("spacing_m must be positive")

    ordered_ids = _ordered_agent_ids(agent_ids)
    count = len(ordered_ids)
    offsets: dict[str, Position3D] = {}
    for index, agent_id in enumerate(ordered_ids):
        if formation == "line":
            offset = _line_offset(index, count, spacing_m)
        elif formation == "column":
            offset = _column_offset(index, count, spacing_m)
        elif formation == "wedge":
            offset = _wedge_offset(index, spacing_m)
        elif formation == "ring":
            offset = _ring_offset(index, count, spacing_m)
        elif formation == "square_patrol":
            offset = _square_patrol_offset(agent_id, index, count, spacing_m)
        elif formation == "random_cloud":
            offset = _random_cloud_offset(agent_id, spacing_m)
        else:
            offset = _grid_offset(index, count, spacing_m)
        offsets[agent_id] = offset

    return offsets


def motion_center(state: MissionActionState,
                  time_seconds: float) -> Position3D:
    """Return the formation center for a mission action state at time."""
    if state.motion == "forward":
        center = (state.speed_mps * time_seconds, 0.0, 0.0)
        return center

    if state.motion == "path_follow":
        progress = (time_seconds % DEFAULT_PATH_PERIOD_S) / DEFAULT_PATH_PERIOD_S
        angle = progress * math.pi * 2.0
        center = (
            math.cos(angle) * DEFAULT_PATH_RADIUS_M,
            0.0,
            math.sin(angle) * DEFAULT_PATH_RADIUS_M,
        )
        return center

    return (0.0, 0.0, 0.0)


def mission_action_positions(agent_ids: list[str],
                             state: MissionActionState,
                             time_seconds: float) -> dict[str, Position3D]:
    """Generate truth positions for a mission action state and time."""
    current_offsets = formation_offsets(
        agent_ids,
        state.formation,
        spacing_m=state.spacing_m,
    )
    previous_offsets = (
        formation_offsets(agent_ids, state.previous_formation, spacing_m=state.spacing_m)
        if state.previous_formation is not None
        else None
    )
    center = motion_center(state, time_seconds)
    transition_progress = 1.0
    if previous_offsets is not None and state.transition_started_at_s is not None:
        transition_progress = (
            (time_seconds - state.transition_started_at_s)
            / state.transition_duration_s
        )

    positions: dict[str, Position3D] = {}
    ordered_ids = _ordered_agent_ids(agent_ids)
    square_patrol_corners = set(ordered_ids[:4]) if state.formation == "square_patrol" else set()
    for agent_id in agent_ids:
        current_offset = current_offsets.get(agent_id, (0.0, 0.0, 0.0))
        previous_offset = (
            previous_offsets.get(agent_id, current_offset)
            if previous_offsets is not None
            else current_offset
        )
        formation_offset = _interpolate_position(
            previous_offset,
            current_offset,
            transition_progress,
        )
        drift_offset = (0.0, 0.0, 0.0)
        if state.motion == "random_walk":
            if agent_id in square_patrol_corners:
                drift_offset = (0.0, 0.0, 0.0)
            elif state.formation == "square_patrol":
                drift_offset = _square_patrol_random_walk_offset(
                    agent_id,
                    formation_offset,
                    time_seconds,
                    state.random_walk_amplitude_m,
                    state.spacing_m,
                )
            else:
                drift_offset = _random_walk_offset(
                    agent_id,
                    time_seconds,
                    state.random_walk_amplitude_m,
                )
        position = _add_position(_add_position(center, formation_offset), drift_offset)
        positions[agent_id] = position

    return positions
