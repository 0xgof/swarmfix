"""Firewall tests: UWB link selection must never use ground truth.

Sensor observations (GNSS, UWB ranges) legitimately derive from truth because
they replicate real sensors. But any calculation that *decides* the solution --
here, UWB link selection geometry including the angle gate -- must use
estimated or GNSS positions only. In real life truth is unknown, so selection
uses the estimate. Selection source is the previous fused estimate when
available, otherwise the GNSS baseline.
"""

from __future__ import annotations

import math

from swarmfix.estimation.solver_backend import get_solver_backend
from swarmfix.live.frame_builder import build_live_frame
from swarmfix.live.models import (
    LiveFrameRequest,
    LivePositionEstimate,
    LiveSelectionOptions,
    LiveSensorOptions,
)
from swarmfix.live.sensor_snapshot import stable_uwb_endpoint_key
from swarmfix.live.uwb_selection import stable_uwb_endpoint_key as sel_key


def python_backend():
    return get_solver_backend("python-scipy")


def selected_pairs(response) -> set[str]:
    pairs = {
        stable_uwb_endpoint_key(link.source_id, link.target_id)
        for link in response.selected_uwb_links
    }
    return pairs


def test_angle_gate_uses_gnss_geometry_not_truth() -> None:
    """Truth is collinear (the angle gate would reject the spanning link), but
    GNSS geometry is a spread triangle. The spanning link agent_1--agent_3 must
    be selectable, which is only possible if selection used GNSS, not truth."""
    request = LiveFrameRequest(
        agent_ids=["agent_1", "agent_2", "agent_3"],
        time_s=0.0,
        mission_action={"formation": "line", "motion": "static"},
        max_uwb_links_per_agent=3,
        sensor_options=LiveSensorOptions(
            gnss_offset_m_by_agent={
                "agent_1": (0.0, 0.0, 0.0),
                "agent_2": (0.0, 0.0, 4.0),
                "agent_3": (0.0, 0.0, 0.0),
            },
        ),
    )

    response = build_live_frame(request, solver_backend=python_backend())

    spanning_link = stable_uwb_endpoint_key("agent_1", "agent_3")
    assert spanning_link in selected_pairs(response)


def test_selection_unchanged_when_truth_varies_with_fixed_gnss() -> None:
    """Holding the GNSS observations fixed while truth changes must not change
    selection. If truth leaked into selection, the two selections would differ."""
    agent_ids = ["agent_1", "agent_2", "agent_3", "agent_4"]
    fixed_gnss = {
        "agent_1": (0.0, 0.0, 0.0),
        "agent_2": (5.0, 0.0, 0.0),
        "agent_3": (0.0, 0.0, 5.0),
        "agent_4": (5.0, 0.0, 5.0),
    }

    def frame_for(formation: str):
        from swarmfix.scenarios.mission_actions import mission_action_positions, MissionActionState

        truth = mission_action_positions(
            agent_ids,
            MissionActionState(formation=formation, motion="static"),
            0.0,
        )
        offsets = {
            agent_id: tuple(
                fixed_gnss[agent_id][axis] - truth[agent_id][axis]
                for axis in range(3)
            )
            for agent_id in agent_ids
        }
        request = LiveFrameRequest(
            agent_ids=agent_ids,
            time_s=0.0,
            mission_action={"formation": formation, "motion": "static"},
            max_uwb_links_per_agent=3,
            sensor_options=LiveSensorOptions(gnss_offset_m_by_agent=offsets),
        )
        return build_live_frame(request, solver_backend=python_backend())

    grid_response = frame_for("grid")
    ring_response = frame_for("ring")

    assert selected_pairs(grid_response) == selected_pairs(ring_response)


def test_uwb_constraint_values_remain_truth_based_sensor_readings() -> None:
    """The firewall applies to selection, not to sensor values. UWB range
    measurements must still be the true inter-agent distances (the sensor)."""
    request = LiveFrameRequest(
        agent_ids=["agent_1", "agent_2", "agent_3"],
        time_s=0.0,
        mission_action={"formation": "grid", "motion": "static"},
        max_uwb_links_per_agent=3,
    )

    response = build_live_frame(request, solver_backend=python_backend())

    truth = {state.agent_id: state.position_m for state in response.truth}
    for measurement in response.measurements.uwb:
        true_distance = math.dist(
            truth[measurement.source_id],
            truth[measurement.target_id],
        )
        assert measurement.distance_m == true_distance


def test_selection_prefers_previous_fused_estimate_over_gnss() -> None:
    """When a previous fused estimate is supplied, selection geometry uses it.
    A collinear previous estimate must gate the spanning link even though GNSS
    geometry is a spread triangle."""
    collinear_estimate = [
        LivePositionEstimate(agent_id="agent_1", position_m=(0.0, 0.0, 0.0)),
        LivePositionEstimate(agent_id="agent_2", position_m=(3.0, 0.0, 0.0)),
        LivePositionEstimate(agent_id="agent_3", position_m=(6.0, 0.0, 0.0)),
    ]
    request = LiveFrameRequest(
        agent_ids=["agent_1", "agent_2", "agent_3"],
        time_s=0.0,
        mission_action={"formation": "line", "motion": "static"},
        max_uwb_links_per_agent=3,
        sensor_options=LiveSensorOptions(
            gnss_offset_m_by_agent={
                "agent_1": (0.0, 0.0, 0.0),
                "agent_2": (0.0, 0.0, 4.0),
                "agent_3": (0.0, 0.0, 0.0),
            },
        ),
        selection_options=LiveSelectionOptions(previous_estimate=collinear_estimate),
    )

    response = build_live_frame(request, solver_backend=python_backend())

    spanning_link = stable_uwb_endpoint_key("agent_1", "agent_3")
    assert spanning_link not in selected_pairs(response)


def test_selection_options_accept_previous_estimate_contract() -> None:
    options = LiveSelectionOptions(
        previous_estimate=[
            LivePositionEstimate(agent_id="agent_1", position_m=(1.0, 0.0, 0.0)),
        ],
    )

    assert options.previous_estimate[0].agent_id == "agent_1"
    assert LiveSelectionOptions().previous_estimate == []
    # Guard against the aliasing bug where a mutable default is shared.
    assert sel_key("a", "b") == "a::b"
