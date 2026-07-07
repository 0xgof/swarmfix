"""Live solver API tests for the interactive viewer contract."""

from __future__ import annotations

import math

import pytest
from pydantic import ValidationError

from swarmfix.estimation.uwb_gnss_fusion import estimate_uwb_gnss_fusion
from swarmfix.models.estimates import EstimateSet
from swarmfix.models.residuals import SolverTrace
from swarmfix.live.solve_request import solve_live_request
from swarmfix.live.models import (
    LiveAgentState,
    LiveEstimationOptions,
    LiveGnssMeasurement,
    LiveSolveRequest,
    LiveUwbMeasurement,
    SelectedUwbLink,
)
from swarmfix.models.measurements import MeasurementSet, GnssMeasurement, UwbRangeMeasurement


def _python_backend() -> object:
    """Return the Python reference backend for tests that pin Python behavior."""
    from swarmfix.estimation.solver_backend import get_solver_backend

    backend = get_solver_backend("python-scipy")
    return backend


class _RecordingBackend:
    """Test backend that proves live solving uses the selected backend."""

    name = "recording-backend"

    def __init__(self) -> None:
        self.call_count = 0

    def solve(self,
              measurements: MeasurementSet,
              max_iterations: int = 100,
              robust_loss: str = "linear") -> tuple[EstimateSet, SolverTrace]:
        """Record the call and delegate to the Python reference solver."""
        self.call_count += 1
        backend_result = estimate_uwb_gnss_fusion(
            measurements,
            max_iterations=max_iterations,
            robust_loss=robust_loss,
        )
        return backend_result


def _valid_request(selected_links: list[SelectedUwbLink] | None = None) -> LiveSolveRequest:
    agents = [
        LiveAgentState(agent_id="a", position_m=(0.0, 0.0, 0.0)),
        LiveAgentState(agent_id="b", position_m=(4.0, 0.0, 0.0)),
        LiveAgentState(agent_id="c", position_m=(0.0, 3.0, 0.0)),
    ]
    gnss = [
        LiveGnssMeasurement(agent_id="a", position_m=(0.5, -0.1, 0.0), sigma_m=1.5),
        LiveGnssMeasurement(agent_id="b", position_m=(4.4, 0.2, 0.0), sigma_m=1.5),
        LiveGnssMeasurement(agent_id="c", position_m=(-0.2, 3.5, 0.0), sigma_m=1.5),
    ]
    uwb = [
        LiveUwbMeasurement(source_id="a", target_id="b", distance_m=4.0, sigma_m=0.15),
        LiveUwbMeasurement(source_id="a", target_id="c", distance_m=3.0, sigma_m=0.15),
        LiveUwbMeasurement(source_id="b", target_id="c", distance_m=5.0, sigma_m=0.15),
    ]
    request = LiveSolveRequest(
        dimension=3,
        agents=agents,
        gnss=gnss,
        uwb=uwb,
        selected_uwb_links=selected_links,
        estimation=LiveEstimationOptions(max_iterations=60),
    )
    return request


def _direct_python_fusion(request: LiveSolveRequest) -> dict[str, tuple[float, ...]]:
    measurements = MeasurementSet(
        gnss=[
            GnssMeasurement(
                agent_id=measurement.agent_id,
                position_m=measurement.position_m,
                sigma_m=measurement.sigma_m,
            )
            for measurement in request.gnss
        ],
        uwb=[
            UwbRangeMeasurement(
                source_id=measurement.source_id,
                target_id=measurement.target_id,
                distance_m=measurement.distance_m,
                sigma_m=measurement.sigma_m,
            )
            for measurement in request.uwb
        ],
    )
    estimates, _trace = estimate_uwb_gnss_fusion(
        measurements,
        max_iterations=request.estimation.max_iterations,
        robust_loss=request.estimation.robust_loss,
    )
    estimate_map = estimates.as_position_map()
    return estimate_map


def test_live_solve_matches_authoritative_python_fusion() -> None:
    request = _valid_request()
    expected_positions = _direct_python_fusion(request)

    response = solve_live_request(request, solver_backend=_python_backend())

    fused_positions = {
        estimate.agent_id: estimate.position_m
        for estimate in response.estimates.fused
    }
    assert fused_positions.keys() == expected_positions.keys()
    for agent_id, expected_position in expected_positions.items():
        actual_position = fused_positions[agent_id]
        assert actual_position == pytest.approx(expected_position, abs=1e-8)
    assert response.trace.iterations
    assert response.metadata.solver == "python-scipy"


def test_live_solve_default_uses_c_solver_when_native_library_is_available() -> None:
    from swarmfix.estimation.backends.c_solver import CSolverUnavailableError

    request = _valid_request()

    try:
        response = solve_live_request(request)
    except CSolverUnavailableError as error:
        pytest.skip(f"C solver library is not built locally: {error}")

    assert response.metadata.solver == "c-uwb-gnss"


def test_live_solve_uses_selected_backend_and_reports_metadata() -> None:
    request = _valid_request()
    backend = _RecordingBackend()

    response = solve_live_request(request, solver_backend=backend)

    assert backend.call_count == 1
    assert response.metadata.solver == "recording-backend"


def test_selected_uwb_links_change_constraints_without_inventing_uwb_positions() -> None:
    request = _valid_request(
        selected_links=[SelectedUwbLink(source_id="a", target_id="b")]
    )

    response = solve_live_request(request, solver_backend=_python_backend())

    assert len(response.constraints.edges) == 1
    assert response.constraints.edges[0].source_id == "a"
    assert response.constraints.edges[0].target_id == "b"
    assert response.constraints.nodes_by_agent("a").constraint_state == "weak_uwb"
    assert response.constraints.nodes_by_agent("b").constraint_state == "weak_uwb"
    assert response.constraints.nodes_by_agent("c").constraint_state == "no_uwb"
    assert not hasattr(response.constraints.nodes_by_agent("a"), "uwb_position_m")


def test_multi_link_agents_are_marked_as_constrained_by_triangulation() -> None:
    request = _valid_request()

    response = solve_live_request(request, solver_backend=_python_backend())

    for agent_id in ("a", "b", "c"):
        node = response.constraints.nodes_by_agent(agent_id)
        assert node.selected_uwb_degree == 2
        assert node.constraint_state == "multi_uwb"
        assert node.graph_support == "triangle"


def test_live_solve_distinguishes_chain_support_from_closed_triangle() -> None:
    request = _valid_request(
        selected_links=[
            SelectedUwbLink(source_id="a", target_id="b"),
            SelectedUwbLink(source_id="b", target_id="c"),
        ]
    )

    response = solve_live_request(request, solver_backend=_python_backend())

    assert response.constraints.nodes_by_agent("a").graph_support == "chain"
    assert response.constraints.nodes_by_agent("b").graph_support == "chain"
    assert response.constraints.nodes_by_agent("c").graph_support == "chain"


def test_live_solve_marks_single_selected_link_as_weak_range_support() -> None:
    request = _valid_request(
        selected_links=[SelectedUwbLink(source_id="a", target_id="b")]
    )

    response = solve_live_request(request, solver_backend=_python_backend())

    assert response.constraints.nodes_by_agent("a").graph_support == "weak_range"
    assert response.constraints.nodes_by_agent("b").graph_support == "weak_range"
    assert response.constraints.nodes_by_agent("c").graph_support == "none"


def test_live_solve_rejects_unknown_uwb_endpoint() -> None:
    request = _valid_request()
    request.uwb[0] = LiveUwbMeasurement(
        source_id="a",
        target_id="missing",
        distance_m=4.0,
        sigma_m=0.15,
    )

    with pytest.raises(ValueError, match="unknown UWB endpoint"):
        solve_live_request(request, solver_backend=_python_backend())


def test_live_solve_rejects_duplicate_undirected_uwb_links() -> None:
    request = _valid_request()
    request.uwb.append(
        LiveUwbMeasurement(source_id="b", target_id="a", distance_m=4.0, sigma_m=0.15)
    )

    with pytest.raises(ValueError, match="duplicate UWB link"):
        solve_live_request(request, solver_backend=_python_backend())


def test_live_solve_rejects_selected_link_not_present_in_measurements() -> None:
    request = _valid_request(
        selected_links=[SelectedUwbLink(source_id="a", target_id="missing")]
    )

    with pytest.raises(ValueError, match="selected UWB link is not available"):
        solve_live_request(request, solver_backend=_python_backend())


def test_live_solve_rejects_dimension_mismatches() -> None:
    request = _valid_request()
    request.gnss[0] = LiveGnssMeasurement(
        agent_id="a",
        position_m=(0.0, 0.0),
        sigma_m=1.0,
    )

    with pytest.raises(ValueError, match="dimension"):
        solve_live_request(request, solver_backend=_python_backend())


def test_live_solve_requires_gnss_for_each_agent() -> None:
    request = _valid_request()
    request.gnss = request.gnss[:-1]

    with pytest.raises(ValueError, match="GNSS measurement for each agent"):
        solve_live_request(request, solver_backend=_python_backend())


def test_live_solve_rejects_invalid_solver_options() -> None:
    with pytest.raises(ValidationError, match="robust_loss"):
        LiveEstimationOptions(robust_loss="unsupported")


def test_live_solve_reports_edge_residuals_from_final_trace() -> None:
    request = _valid_request()

    response = solve_live_request(request, solver_backend=_python_backend())

    edge = response.constraints.edges[0]
    assert edge.residual_m is not None
    assert edge.weighted_sq is not None
    assert math.isfinite(edge.residual_m)
    assert math.isfinite(edge.weighted_sq)
