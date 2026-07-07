"""Tests for backend-authoritative mission action geometry."""

from __future__ import annotations

import math

import pytest


AGENT_IDS = ["agent_0", "agent_1", "agent_2", "agent_3", "agent_4"]


def _distance(a: tuple[float, float, float],
              b: tuple[float, float, float]) -> float:
    distance = math.dist(a, b)
    return distance


def test_backend_mission_action_catalog_exposes_supported_modes() -> None:
    from swarmfix.scenarios.mission_actions import mission_action_catalog

    catalog = mission_action_catalog()

    assert [formation.id for formation in catalog.formations] == [
        "grid",
        "line",
        "column",
        "wedge",
        "ring",
        "square_patrol",
        "random_cloud",
    ]
    assert [motion.id for motion in catalog.motions] == [
        "static",
        "random_walk",
        "forward",
        "path_follow",
    ]
    line = next(formation for formation in catalog.formations if formation.id == "line")
    assert line.solver_geometry_risk == "high"
    assert "collinear" in line.geometry_traits


def test_backend_square_patrol_requires_interior_rover_and_locks_corners() -> None:
    from swarmfix.scenarios.mission_actions import formation_offsets

    offsets = formation_offsets(AGENT_IDS, "square_patrol", spacing_m=3.0)

    assert offsets["agent_0"] == pytest.approx((-3.0, 0.0, -3.0))
    assert offsets["agent_1"] == pytest.approx((3.0, 0.0, -3.0))
    assert offsets["agent_2"] == pytest.approx((3.0, 0.0, 3.0))
    assert offsets["agent_3"] == pytest.approx((-3.0, 0.0, 3.0))
    assert -3.0 < offsets["agent_4"][0] < 3.0
    assert -3.0 < offsets["agent_4"][2] < 3.0

    with pytest.raises(ValueError, match="at least 5"):
        formation_offsets(AGENT_IDS[:4], "square_patrol", spacing_m=3.0)


def test_backend_grid_offsets_match_current_viewer_visible_layout() -> None:
    from swarmfix.scenarios.mission_actions import formation_offsets

    first_offsets = formation_offsets(AGENT_IDS, "grid", spacing_m=3.0)
    repeated_offsets = formation_offsets(list(reversed(AGENT_IDS)), "grid", spacing_m=3.0)

    assert first_offsets == repeated_offsets
    assert first_offsets["agent_0"] == pytest.approx((-3.0, 0.0, -1.5))
    assert first_offsets["agent_1"] == pytest.approx((0.0, 0.0, -1.5))
    assert first_offsets["agent_2"] == pytest.approx((3.0, 0.0, -1.5))
    assert first_offsets["agent_3"] == pytest.approx((-3.0, 0.0, 1.5))
    assert first_offsets["agent_4"] == pytest.approx((0.0, 0.0, 1.5))
    assert _distance(first_offsets["agent_0"], first_offsets["agent_1"]) == pytest.approx(3.0)


def test_backend_default_state_matches_current_viewer_default_action() -> None:
    from swarmfix.scenarios.mission_actions import MissionActionState

    state = MissionActionState()

    assert state.formation == "grid"
    assert state.motion == "random_walk"
    assert state.spacing_m == pytest.approx(3.0)
    assert state.speed_mps == pytest.approx(1.0)
    assert state.random_walk_amplitude_m == pytest.approx(0.24)
    assert state.path == "loop"
    assert state.previous_formation is None
    assert state.transition_started_at_s is None
    assert state.transition_duration_s == pytest.approx(2.0)


def test_backend_line_and_column_are_collinear() -> None:
    from swarmfix.scenarios.mission_actions import formation_offsets

    line_offsets = formation_offsets(AGENT_IDS, "line", spacing_m=3.0)
    column_offsets = formation_offsets(AGENT_IDS, "column", spacing_m=3.0)

    assert {position[2] for position in line_offsets.values()} == {0.0}
    assert {position[0] for position in column_offsets.values()} == {0.0}
    assert line_offsets["agent_0"][0] < line_offsets["agent_4"][0]
    assert column_offsets["agent_0"][2] < column_offsets["agent_4"][2]


def test_backend_random_cloud_is_repeatable_and_bounded() -> None:
    from swarmfix.scenarios.mission_actions import formation_offsets

    offsets = formation_offsets(AGENT_IDS, "random_cloud", spacing_m=3.0)
    repeated_offsets = formation_offsets(AGENT_IDS, "random_cloud", spacing_m=3.0)

    assert offsets == repeated_offsets
    for position in offsets.values():
        assert math.dist(position, (0.0, 0.0, 0.0)) <= 8.0


def test_backend_motion_centers_and_positions_follow_action_state() -> None:
    from swarmfix.scenarios.mission_actions import (
        MissionActionState,
        mission_action_positions,
        motion_center,
    )

    static_state = MissionActionState(motion="static")
    forward_state = MissionActionState(motion="forward", speed_mps=2.0)
    path_state = MissionActionState(motion="path_follow")

    assert motion_center(static_state, 0.0) == motion_center(static_state, 20.0)
    assert motion_center(forward_state, 3.0) == pytest.approx((6.0, 0.0, 0.0))
    assert motion_center(path_state, 0.0) != motion_center(path_state, 4.0)

    start_positions = mission_action_positions(AGENT_IDS, forward_state, 0.0)
    later_positions = mission_action_positions(AGENT_IDS, forward_state, 3.0)

    assert later_positions["agent_0"][0] == pytest.approx(start_positions["agent_0"][0] + 6.0)


def test_backend_random_walk_is_repeatable_and_bounded() -> None:
    from swarmfix.scenarios.mission_actions import MissionActionState, mission_action_positions

    state = MissionActionState(motion="random_walk", random_walk_amplitude_m=0.4)
    positions = mission_action_positions(AGENT_IDS, state, 4.5)
    repeated_positions = mission_action_positions(AGENT_IDS, state, 4.5)
    base_positions = mission_action_positions(
        AGENT_IDS,
        MissionActionState(motion="static"),
        4.5,
    )

    assert positions == repeated_positions
    for agent_id, position in positions.items():
        assert _distance(position, base_positions[agent_id]) <= 0.75


def test_backend_random_walk_uses_agent_specific_motion() -> None:
    from swarmfix.scenarios.mission_actions import MissionActionState, mission_action_positions

    state = MissionActionState(motion="random_walk", random_walk_amplitude_m=1.0)
    start_positions = mission_action_positions(AGENT_IDS, state, 1.0)
    later_positions = mission_action_positions(AGENT_IDS, state, 2.0)
    motion_deltas = [
        tuple(
            round(later_positions[agent_id][axis] - start_positions[agent_id][axis], 2)
            for axis in range(3)
        )
        for agent_id in AGENT_IDS
    ]
    displacement_m = [
        _distance(later_positions[agent_id], start_positions[agent_id])
        for agent_id in AGENT_IDS
    ]

    assert len(set(motion_deltas)) > 1
    assert max(displacement_m) > 0.2


def test_backend_square_patrol_random_walk_moves_only_inside_agents() -> None:
    from swarmfix.scenarios.mission_actions import MissionActionState, mission_action_positions

    state = MissionActionState(
        formation="square_patrol",
        motion="random_walk",
        spacing_m=3.0,
        random_walk_amplitude_m=1.0,
    )

    start_positions = mission_action_positions(AGENT_IDS, state, 1.0)
    later_positions = mission_action_positions(AGENT_IDS, state, 2.0)

    for agent_id in AGENT_IDS[:4]:
        assert later_positions[agent_id] == pytest.approx(start_positions[agent_id])
    assert later_positions["agent_4"] != pytest.approx(start_positions["agent_4"])
    assert -3.0 <= later_positions["agent_4"][0] <= 3.0
    assert -3.0 <= later_positions["agent_4"][2] <= 3.0


def test_backend_transition_interpolates_between_formations() -> None:
    from swarmfix.scenarios.mission_actions import (
        MissionActionState,
        formation_offsets,
        mission_action_positions,
    )

    state = MissionActionState(
        formation="line",
        motion="static",
        previous_formation="grid",
        transition_started_at_s=10.0,
        transition_duration_s=4.0,
    )
    start_positions = mission_action_positions(AGENT_IDS, state, 10.0)
    mid_positions = mission_action_positions(AGENT_IDS, state, 12.0)
    final_positions = mission_action_positions(AGENT_IDS, state, 14.0)
    grid_offsets = formation_offsets(AGENT_IDS, "grid")
    line_offsets = formation_offsets(AGENT_IDS, "line")

    assert start_positions["agent_4"] == grid_offsets["agent_4"]
    assert final_positions["agent_4"] == line_offsets["agent_4"]
    assert mid_positions["agent_4"] != grid_offsets["agent_4"]
    assert mid_positions["agent_4"] != line_offsets["agent_4"]


def test_backend_mission_action_rejects_invalid_numeric_settings() -> None:
    from pydantic import ValidationError

    from swarmfix.scenarios.mission_actions import MissionActionState, formation_offsets

    with pytest.raises(ValidationError, match="spacing_m"):
        MissionActionState(spacing_m=0.0)

    with pytest.raises(ValidationError, match="speed_mps"):
        MissionActionState(speed_mps=-1.0)

    with pytest.raises(ValidationError, match="transition_duration_s"):
        MissionActionState(transition_duration_s=0.0)

    with pytest.raises(ValueError, match="spacing_m"):
        formation_offsets(AGENT_IDS, "grid", spacing_m=0.0)
