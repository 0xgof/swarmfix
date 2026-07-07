"""Behavior tests for the backend live sensor snapshot builder.

BLF-002: the backend builds truth, GNSS, and UWB candidate measurements from
mission-action positions, preserving the viewer's live sensor behavior:
scene-derived per-agent GNSS offsets, deterministic hash-based fallback
offsets, median-style fallback sigmas supplied through ``sensor_options``,
and noiseless all-pair UWB candidates.
"""

from __future__ import annotations

import math

from swarmfix.live.models import LiveFrameRequest, LiveSensorOptions
from swarmfix.live.sensor_snapshot import build_sensor_snapshot
from swarmfix.scenarios.mission_actions import mission_action_positions


def make_static_grid_request(agent_ids: list[str] | None = None,
                             sensor_options: LiveSensorOptions | None = None,
                             time_s: float = 2.0) -> LiveFrameRequest:
    """Return a static grid live-frame request with optional sensor policy."""
    request = LiveFrameRequest(
        agent_ids=agent_ids or ["agent_1", "agent_2", "agent_3", "agent_4"],
        time_s=time_s,
        mission_action={"formation": "grid", "motion": "static"},
        max_uwb_links_per_agent=3,
        sensor_options=sensor_options or LiveSensorOptions(),
    )
    return request


def truth_by_agent(snapshot) -> dict[str, tuple[float, ...]]:
    return {state.agent_id: state.position_m for state in snapshot.truth}


def gnss_by_agent(snapshot) -> dict[str, object]:
    return {measurement.agent_id: measurement for measurement in snapshot.gnss}


def test_static_grid_truth_matches_backend_mission_positions() -> None:
    request = make_static_grid_request()

    snapshot = build_sensor_snapshot(request)

    expected_positions = mission_action_positions(
        request.agent_ids,
        request.mission_action,
        request.time_s,
    )
    assert truth_by_agent(snapshot) == expected_positions


def test_snapshot_is_deterministic_across_calls() -> None:
    request = make_static_grid_request()

    first_snapshot = build_sensor_snapshot(request)
    second_snapshot = build_sensor_snapshot(request)

    assert first_snapshot == second_snapshot


def test_random_walk_motion_updates_gnss_and_uwb_with_time() -> None:
    early_request = LiveFrameRequest(
        agent_ids=["agent_1", "agent_2", "agent_3"],
        time_s=0.0,
        mission_action={
            "formation": "grid",
            "motion": "random_walk",
            "random_walk_amplitude_m": 0.5,
        },
        max_uwb_links_per_agent=3,
    )
    late_request = early_request.model_copy(update={"time_s": 5.0})

    early_snapshot = build_sensor_snapshot(early_request)
    late_snapshot = build_sensor_snapshot(late_request)

    early_gnss = gnss_by_agent(early_snapshot)["agent_1"].position_m
    late_gnss = gnss_by_agent(late_snapshot)["agent_1"].position_m
    assert early_gnss != late_gnss
    early_distances = [candidate.distance_m for candidate in early_snapshot.uwb_candidates]
    late_distances = [candidate.distance_m for candidate in late_snapshot.uwb_candidates]
    assert early_distances != late_distances


def test_supplied_gnss_offset_is_applied_to_truth() -> None:
    sensor_options = LiveSensorOptions(
        gnss_offset_m_by_agent={"agent_1": (0.4, 0.1, -0.2)},
    )
    request = make_static_grid_request(sensor_options=sensor_options)

    snapshot = build_sensor_snapshot(request)

    truth_position = truth_by_agent(snapshot)["agent_1"]
    gnss_position = gnss_by_agent(snapshot)["agent_1"].position_m
    expected_gnss_position = (
        truth_position[0] + 0.4,
        truth_position[1] + 0.1,
        truth_position[2] + -0.2,
    )
    assert gnss_position == expected_gnss_position


def test_missing_gnss_offset_uses_deterministic_ground_plane_fallback() -> None:
    request = make_static_grid_request()

    first_snapshot = build_sensor_snapshot(request)
    second_snapshot = build_sensor_snapshot(request)

    truth_position = truth_by_agent(first_snapshot)["agent_2"]
    gnss_position = gnss_by_agent(first_snapshot)["agent_2"].position_m
    offset = tuple(
        gnss_axis - truth_axis
        for gnss_axis, truth_axis in zip(gnss_position, truth_position)
    )
    assert offset[1] == 0.0
    fallback_sigma_m = request.sensor_options.gnss_fallback_sigma_m
    safe_sigma_m = max(0.25, fallback_sigma_m)
    offset_radius_m = math.hypot(offset[0], offset[2])
    assert safe_sigma_m * 0.28 <= offset_radius_m <= safe_sigma_m * 0.44
    assert gnss_by_agent(second_snapshot)["agent_2"].position_m == gnss_position


def test_gnss_sigma_prefers_per_agent_value_and_falls_back() -> None:
    sensor_options = LiveSensorOptions(
        gnss_sigma_m_by_agent={"agent_1": 1.7},
        gnss_fallback_sigma_m=2.5,
    )
    request = make_static_grid_request(sensor_options=sensor_options)

    snapshot = build_sensor_snapshot(request)

    assert gnss_by_agent(snapshot)["agent_1"].sigma_m == 1.7
    assert gnss_by_agent(snapshot)["agent_2"].sigma_m == 2.5


def test_uwb_candidates_cover_all_pairs_with_euclidean_distances() -> None:
    request = make_static_grid_request()

    snapshot = build_sensor_snapshot(request)

    agent_count = len(request.agent_ids)
    expected_pair_count = agent_count * (agent_count - 1) // 2
    assert len(snapshot.uwb_candidates) == expected_pair_count
    truth_positions = truth_by_agent(snapshot)
    for candidate in snapshot.uwb_candidates:
        source_position = truth_positions[candidate.source_id]
        target_position = truth_positions[candidate.target_id]
        euclidean_distance_m = math.sqrt(
            sum(
                (source_axis - target_axis) ** 2
                for source_axis, target_axis in zip(source_position, target_position)
            )
        )
        assert candidate.distance_m == euclidean_distance_m
        assert candidate.true_distance_m == euclidean_distance_m


def test_uwb_sigma_prefers_per_link_value_and_falls_back() -> None:
    sensor_options = LiveSensorOptions(
        uwb_sigma_m_by_link={"agent_1::agent_2": 0.35},
        uwb_fallback_sigma_m=0.2,
    )
    request = make_static_grid_request(sensor_options=sensor_options)

    snapshot = build_sensor_snapshot(request)

    sigma_by_pair = {
        tuple(sorted((candidate.source_id, candidate.target_id))): candidate.sigma_m
        for candidate in snapshot.uwb_candidates
    }
    assert sigma_by_pair[("agent_1", "agent_2")] == 0.35
    assert sigma_by_pair[("agent_1", "agent_3")] == 0.2
