"""Contract tests for backend-owned live-frame request and response models.

BLF-001: the viewer sends mission intent and options instead of prebuilt
measurements, and the backend returns a complete render-ready frame. These
tests pin the field names, defaults, and validation behavior that later
tickets (BLF-002 through BLF-005) build against.
"""

from __future__ import annotations

import math

import pytest
from pydantic import ValidationError

from swarmfix.live.models import (
    LiveAgentState,
    LiveConstraintSection,
    LiveEstimateSection,
    LiveEstimationOptions,
    LiveFrameEstimationOptions,
    LiveFrameMeasurementSection,
    LiveFrameMetadata,
    LiveFrameRequest,
    LiveFrameResponse,
    LiveGnssMeasurement,
    LiveSelectedUwbLink,
    LiveSelectionOptions,
    LiveSensorOptions,
    LiveSolveRequest,
    LiveTraceSection,
    LiveUwbMeasurement,
    LiveUwbSelectionDiagnostics,
    SelectedUwbLink,
)
from swarmfix.observability.events import TraceContext


def make_minimal_live_frame_request() -> LiveFrameRequest:
    """Return the smallest valid live-frame request the viewer can send."""
    request = LiveFrameRequest(
        agent_ids=["agent_1", "agent_2", "agent_3"],
        time_s=1.5,
        max_uwb_links_per_agent=3,
    )
    return request


def test_minimal_live_frame_request_parses_with_documented_defaults() -> None:
    request = make_minimal_live_frame_request()

    assert request.schema_version == "0.1.0"
    assert request.mission_action.formation == "grid"
    assert request.mission_action.motion == "random_walk"
    assert request.sensor_options.gnss_fallback_sigma_m == 1.0
    assert request.sensor_options.uwb_fallback_sigma_m == 0.1
    assert request.selection_options.previous_selected_links == []
    assert request.selection_options.max_graph_changes_per_frame == 2
    assert request.selection_options.min_link_separation_deg == 10.0
    assert request.trace_context is None


def test_live_frame_estimation_defaults_match_current_viewer_solves() -> None:
    """The viewer sends max_iterations=40 today; the live-frame default
    must not silently adopt the 100-iteration LiveEstimationOptions default."""
    request = make_minimal_live_frame_request()

    assert request.estimation.max_iterations == 40
    assert request.estimation.robust_loss == "linear"


def test_solve_request_estimation_default_is_unchanged() -> None:
    """Guard: the measurement-level /solve contract keeps its own default."""
    options = LiveEstimationOptions()

    assert options.max_iterations == 100


def test_live_frame_request_accepts_full_intent_and_options() -> None:
    request = LiveFrameRequest(
        agent_ids=["agent_1", "agent_2"],
        time_s=12.25,
        mission_action={"formation": "ring", "motion": "static"},
        max_uwb_links_per_agent=4,
        sensor_options=LiveSensorOptions(
            gnss_offset_m_by_agent={"agent_1": (0.4, 0.0, -0.2)},
            gnss_sigma_m_by_agent={"agent_1": 1.4},
            uwb_sigma_m_by_link={"agent_1::agent_2": 0.15},
            gnss_fallback_sigma_m=1.4,
            uwb_fallback_sigma_m=0.15,
        ),
        selection_options=LiveSelectionOptions(
            max_range_m=25.0,
            add_range_m=25.0,
            drop_range_m=27.5,
            max_graph_changes_per_frame=2,
            min_link_separation_deg=10.0,
            previous_selected_links=[
                SelectedUwbLink(source_id="agent_1", target_id="agent_2"),
            ],
        ),
        estimation=LiveFrameEstimationOptions(max_iterations=40),
        trace_context=TraceContext(
            session_id="session-1",
            trace_id="trace-1",
            span_id="span-1",
        ),
    )

    assert request.mission_action.formation == "ring"
    assert request.selection_options.previous_selected_links[0].source_id == "agent_1"
    assert request.sensor_options.gnss_offset_m_by_agent["agent_1"] == (0.4, 0.0, -0.2)


def test_live_frame_request_rejects_empty_agent_ids() -> None:
    with pytest.raises(ValidationError, match="agent_ids"):
        LiveFrameRequest(agent_ids=[], time_s=0.0, max_uwb_links_per_agent=3)


def test_live_frame_request_rejects_blank_agent_id() -> None:
    with pytest.raises(ValidationError, match="blank"):
        LiveFrameRequest(
            agent_ids=["agent_1", ""],
            time_s=0.0,
            max_uwb_links_per_agent=3,
        )


def test_live_frame_request_rejects_duplicate_agent_ids() -> None:
    with pytest.raises(ValidationError, match="duplicate"):
        LiveFrameRequest(
            agent_ids=["agent_1", "agent_1"],
            time_s=0.0,
            max_uwb_links_per_agent=3,
        )


def test_live_frame_request_rejects_non_finite_time() -> None:
    with pytest.raises(ValidationError, match="time_s"):
        LiveFrameRequest(
            agent_ids=["agent_1"],
            time_s=math.inf,
            max_uwb_links_per_agent=3,
        )


def test_live_frame_request_rejects_negative_uwb_cap() -> None:
    with pytest.raises(ValidationError, match="max_uwb_links_per_agent"):
        LiveFrameRequest(
            agent_ids=["agent_1"],
            time_s=0.0,
            max_uwb_links_per_agent=-1,
        )


def test_sensor_options_reject_non_positive_fallback_sigma() -> None:
    with pytest.raises(ValidationError, match="sigma"):
        LiveSensorOptions(gnss_fallback_sigma_m=0.0)

    with pytest.raises(ValidationError, match="sigma"):
        LiveSensorOptions(uwb_fallback_sigma_m=-0.1)


def test_sensor_options_reject_non_positive_per_agent_sigma() -> None:
    with pytest.raises(ValidationError, match="sigma"):
        LiveSensorOptions(gnss_sigma_m_by_agent={"agent_1": 0.0})

    with pytest.raises(ValidationError, match="sigma"):
        LiveSensorOptions(uwb_sigma_m_by_link={"agent_1::agent_2": -1.0})


def test_selection_options_reject_negative_ranges_and_budget() -> None:
    with pytest.raises(ValidationError, match="range"):
        LiveSelectionOptions(max_range_m=-1.0)

    with pytest.raises(ValidationError, match="range"):
        LiveSelectionOptions(add_range_m=-1.0)

    with pytest.raises(ValidationError, match="range"):
        LiveSelectionOptions(drop_range_m=-1.0)

    with pytest.raises(ValidationError, match="graph_changes"):
        LiveSelectionOptions(max_graph_changes_per_frame=-1)

    with pytest.raises(ValidationError, match="separation"):
        LiveSelectionOptions(min_link_separation_deg=-5.0)


def test_previous_selected_links_reject_self_links() -> None:
    with pytest.raises(ValidationError, match="identical"):
        LiveSelectionOptions(
            previous_selected_links=[
                {"source_id": "agent_1", "target_id": "agent_1"},
            ],
        )


def test_selected_live_uwb_link_rejects_invalid_values() -> None:
    with pytest.raises(ValidationError, match="identical"):
        LiveSelectedUwbLink(
            source_id="agent_1",
            target_id="agent_1",
            measured_distance_m=3.0,
            sigma_m=0.1,
            selection_reason="new",
        )

    with pytest.raises(ValidationError, match="distance"):
        LiveSelectedUwbLink(
            source_id="agent_1",
            target_id="agent_2",
            measured_distance_m=0.0,
            sigma_m=0.1,
            selection_reason="new",
        )


def make_solved_frame_response() -> LiveFrameResponse:
    """Return a fully populated response mirroring a solved backend frame."""
    selected_link = LiveSelectedUwbLink(
        source_id="agent_1",
        target_id="agent_2",
        measured_distance_m=3.0,
        sigma_m=0.1,
        selection_reason="new",
    )
    response = LiveFrameResponse(
        schema_version="0.1.0",
        metadata=LiveFrameMetadata(
            solver="c-uwb-gnss",
            formation="grid",
            motion="static",
            time_s=1.5,
            selected_uwb_count=1,
        ),
        truth=[
            LiveAgentState(agent_id="agent_1", position_m=(0.0, 0.0, 0.0)),
            LiveAgentState(agent_id="agent_2", position_m=(3.0, 0.0, 0.0)),
        ],
        measurements=LiveFrameMeasurementSection(
            gnss=[
                LiveGnssMeasurement(
                    agent_id="agent_1",
                    position_m=(0.3, 0.0, 0.1),
                    sigma_m=1.0,
                ),
            ],
            uwb=[
                LiveUwbMeasurement(
                    source_id="agent_1",
                    target_id="agent_2",
                    distance_m=3.0,
                    sigma_m=0.1,
                ),
            ],
        ),
        selected_uwb_links=[selected_link],
        uwb_selection=LiveUwbSelectionDiagnostics(
            candidate_link_count=1,
            selected_link_count=1,
            max_links_per_agent=3,
            connected_component_count=1,
            isolated_agent_count=0,
            triangle_count=0,
            added_links=1,
            dropped_links=0,
        ),
        estimates=LiveEstimateSection(fused=[], gnss_only=[]),
        trace=LiveTraceSection(trace_type="gauss_newton", iterations=[]),
        constraints=LiveConstraintSection(nodes=[], edges=[]),
        quality=None,
    )
    return response


def test_live_frame_response_serializes_typed_render_ready_frame() -> None:
    response = make_solved_frame_response()

    payload = response.model_dump(mode="json")

    assert payload["metadata"]["formation"] == "grid"
    assert payload["truth"][0]["agent_id"] == "agent_1"
    assert payload["measurements"]["gnss"][0]["sigma_m"] == 1.0
    assert payload["measurements"]["uwb"][0]["distance_m"] == 3.0
    assert payload["selected_uwb_links"][0]["selection_reason"] == "new"
    assert payload["uwb_selection"]["selection_policy"] == "adaptive_range_graph_v1"
    assert payload["uwb_selection"]["adaptive_selection_enabled"] is True
    assert payload["quality"] is None


def test_live_frame_response_roundtrips_through_json_validation() -> None:
    response = make_solved_frame_response()

    revalidated = LiveFrameResponse.model_validate(response.model_dump(mode="json"))

    assert revalidated == response


def test_solve_request_contract_is_untouched_by_live_frame_models() -> None:
    """Guard: /solve keeps accepting measurement-ready requests as before."""
    request = LiveSolveRequest(
        dimension=3,
        agents=[LiveAgentState(agent_id="a", position_m=(0.0, 0.0, 0.0))],
        gnss=[
            LiveGnssMeasurement(
                agent_id="a",
                position_m=(0.1, 0.0, 0.0),
                sigma_m=1.0,
            ),
        ],
    )

    assert request.estimation.max_iterations == 100
    assert request.selected_uwb_links is None
