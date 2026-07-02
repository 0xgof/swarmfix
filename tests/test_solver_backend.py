"""Tests for pluggable estimation solver backends."""

from __future__ import annotations

import sys

import pytest

from swarmfix.estimation.uwb_gnss_fusion import estimate_uwb_gnss_fusion
from swarmfix.models.measurements import GnssMeasurement, MeasurementSet, UwbRangeMeasurement


def _backend_measurements() -> MeasurementSet:
    """Build a small fixture with enough UWB constraints for parity checks."""
    measurements = MeasurementSet(
        gnss=[
            GnssMeasurement(agent_id="a", position_m=(0.3, -0.1, 0.0), sigma_m=1.0),
            GnssMeasurement(agent_id="b", position_m=(4.2, 0.1, 0.0), sigma_m=1.0),
            GnssMeasurement(agent_id="c", position_m=(0.1, 3.1, 0.0), sigma_m=1.0),
        ],
        uwb=[
            UwbRangeMeasurement(source_id="a", target_id="b", distance_m=4.0, sigma_m=0.1),
            UwbRangeMeasurement(source_id="a", target_id="c", distance_m=3.0, sigma_m=0.1),
            UwbRangeMeasurement(source_id="b", target_id="c", distance_m=5.0, sigma_m=0.1),
        ],
    )
    return measurements


def test_python_solver_backend_can_be_selected_by_name() -> None:
    from swarmfix.estimation.solver_backend import get_solver_backend

    backend = get_solver_backend("python-scipy")

    assert backend.name == "python-scipy"


def test_default_solver_backend_is_c_solver_when_native_library_is_available() -> None:
    from swarmfix.estimation.backends.c_solver import CSolverUnavailableError
    from swarmfix.estimation.solver_backend import get_solver_backend

    try:
        backend = get_solver_backend()
    except CSolverUnavailableError as error:
        pytest.skip(f"C solver library is not built locally: {error}")

    assert backend.name == "c-uwb-gnss"


def test_unknown_solver_backend_is_rejected_before_request_handling() -> None:
    from swarmfix.estimation.solver_backend import get_solver_backend

    with pytest.raises(ValueError, match="unknown solver backend"):
        get_solver_backend("missing-backend")


def test_backend_wrapped_python_solver_matches_direct_reference() -> None:
    from swarmfix.estimation.solver_backend import get_solver_backend

    measurements = _backend_measurements()
    backend = get_solver_backend("python-scipy")

    backend_estimates, backend_trace = backend.solve(
        measurements,
        max_iterations=60,
        robust_loss="linear",
    )
    direct_estimates, direct_trace = estimate_uwb_gnss_fusion(
        measurements,
        max_iterations=60,
        robust_loss="linear",
    )

    assert backend_estimates.method == direct_estimates.method
    for estimate in direct_estimates.estimates:
        backend_position = backend_estimates.position_for(estimate.agent_id)
        assert backend_position == pytest.approx(estimate.position_m, abs=1e-8)
    assert backend_trace.iterations[-1].cost_total == pytest.approx(
        direct_trace.iterations[-1].cost_total,
        abs=1e-8,
    )


def test_available_solver_backends_expose_python_without_loading_c_backend() -> None:
    from swarmfix.estimation.solver_backend import available_solver_backend_names

    sys.modules.pop("swarmfix.estimation.backends.c_solver", None)

    backend_names = available_solver_backend_names()

    assert backend_names == ("python-scipy",)
    assert "swarmfix.estimation.backends.c_solver" not in sys.modules
