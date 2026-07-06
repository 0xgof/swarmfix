"""Backend-owned live sensor snapshot construction.

Workflow position: this module sits between backend mission-action position
generation (``swarmfix.scenarios.mission_actions``) and live UWB selection
plus solving (``swarmfix.live``). It converts one ``LiveFrameRequest`` into
the deterministic truth, GNSS, and UWB candidate measurements the live
solver consumes, replacing the viewer's local frame construction.

Behavior parity notes (ported from ``viewer/src/simulation/liveEstimation.ts``):

- truth comes from backend mission-action positions (already 3D, y-up);
- GNSS positions are truth plus a constant per-agent offset; offsets come
  from ``sensor_options`` (scene-derived) or a deterministic FNV-1a
  hash-based fallback in the ground (XZ) plane;
- GNSS/UWB sigmas come from ``sensor_options`` maps with documented
  fallback values;
- UWB candidates cover all unordered agent pairs and are noiseless: the
  measured distance equals the true Euclidean distance between truth
  positions.

This module is deliberately side-effect free. Observability events for
frame building are emitted by the orchestrating endpoint boundary, not here.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from swarmfix.live.models import (
    LiveAgentState,
    LiveFrameRequest,
    LiveGnssMeasurement,
    LiveUwbMeasurement,
)
from swarmfix.live.uwb_selection import stable_uwb_endpoint_key
from swarmfix.scenarios.mission_actions import (
    _agent_sort_key,
    _stable_unit,
    mission_action_positions,
)

FALLBACK_OFFSET_MIN_SIGMA_M = 0.25
FALLBACK_OFFSET_ANGLE_SALT = 131
FALLBACK_OFFSET_RADIUS_SALT = 149

Position3D = tuple[float, float, float]


@dataclass(frozen=True)
class LiveSensorSnapshot:
    """Deterministic truth, GNSS, and UWB candidates for one live frame."""

    truth: tuple[LiveAgentState, ...]
    gnss: tuple[LiveGnssMeasurement, ...]
    uwb_candidates: tuple[LiveUwbMeasurement, ...]


def _fallback_gnss_offset(agent_id: str,
                          fallback_sigma_m: float) -> Position3D:
    """Return the deterministic ground-plane offset for agents without
    a scene-derived GNSS offset, matching the viewer's hash-based fallback."""
    safe_sigma_m = max(FALLBACK_OFFSET_MIN_SIGMA_M, fallback_sigma_m)
    angle = _stable_unit(agent_id, FALLBACK_OFFSET_ANGLE_SALT) * math.pi * 2.0
    radius_m = safe_sigma_m * (
        0.28 + _stable_unit(agent_id, FALLBACK_OFFSET_RADIUS_SALT) * 0.16
    )
    offset = (math.cos(angle) * radius_m, 0.0, math.sin(angle) * radius_m)
    return offset


def _euclidean_distance(source: Position3D,
                        target: Position3D) -> float:
    """Return the 3D distance between two truth positions."""
    distance_m = math.sqrt(
        (source[0] - target[0]) ** 2
        + (source[1] - target[1]) ** 2
        + (source[2] - target[2]) ** 2
    )
    return distance_m


def _build_gnss_measurements(ordered_agent_ids: list[str],
                             truth_positions: dict[str, Position3D],
                             request: LiveFrameRequest) -> tuple[LiveGnssMeasurement, ...]:
    """Apply per-agent offsets and sigma policy to truth positions."""
    sensor_options = request.sensor_options
    measurements = []
    for agent_id in ordered_agent_ids:
        truth_position = truth_positions[agent_id]
        offset = sensor_options.gnss_offset_m_by_agent.get(agent_id)
        if offset is None:
            offset = _fallback_gnss_offset(
                agent_id,
                sensor_options.gnss_fallback_sigma_m,
            )
        gnss_position = (
            truth_position[0] + offset[0],
            truth_position[1] + offset[1],
            truth_position[2] + offset[2],
        )
        sigma_m = sensor_options.gnss_sigma_m_by_agent.get(
            agent_id,
            sensor_options.gnss_fallback_sigma_m,
        )
        measurements.append(
            LiveGnssMeasurement(
                agent_id=agent_id,
                position_m=gnss_position,
                sigma_m=sigma_m,
            )
        )
    return tuple(measurements)


def _build_uwb_candidates(ordered_agent_ids: list[str],
                          truth_positions: dict[str, Position3D],
                          request: LiveFrameRequest) -> tuple[LiveUwbMeasurement, ...]:
    """Generate noiseless all-pair UWB candidates from truth positions."""
    sensor_options = request.sensor_options
    candidates = []
    for source_index, source_id in enumerate(ordered_agent_ids):
        for target_id in ordered_agent_ids[source_index + 1:]:
            distance_m = _euclidean_distance(
                truth_positions[source_id],
                truth_positions[target_id],
            )
            sigma_m = sensor_options.uwb_sigma_m_by_link.get(
                stable_uwb_endpoint_key(source_id, target_id),
                sensor_options.uwb_fallback_sigma_m,
            )
            candidates.append(
                LiveUwbMeasurement(
                    source_id=source_id,
                    target_id=target_id,
                    distance_m=distance_m,
                    sigma_m=sigma_m,
                    true_distance_m=distance_m,
                )
            )
    return tuple(candidates)


def build_sensor_snapshot(request: LiveFrameRequest) -> LiveSensorSnapshot:
    """Build the deterministic sensor snapshot for one live-frame request.

    Truth positions come from the backend mission-action model at the
    requested time. GNSS and UWB candidates are derived from that truth
    using the sensor policy carried in ``request.sensor_options``. The same
    request always produces the same snapshot.
    """
    truth_positions = mission_action_positions(
        request.agent_ids,
        request.mission_action,
        request.time_s,
    )
    ordered_agent_ids = sorted(request.agent_ids, key=_agent_sort_key)
    truth = tuple(
        LiveAgentState(agent_id=agent_id, position_m=truth_positions[agent_id])
        for agent_id in ordered_agent_ids
    )
    gnss = _build_gnss_measurements(ordered_agent_ids, truth_positions, request)
    uwb_candidates = _build_uwb_candidates(ordered_agent_ids, truth_positions, request)
    snapshot = LiveSensorSnapshot(
        truth=truth,
        gnss=gnss,
        uwb_candidates=uwb_candidates,
    )
    return snapshot
