"""Tests for the optional native C UWB/GNSS solver backend."""

from __future__ import annotations

from pathlib import Path

import pytest

from swarmfix.estimation.uwb_gnss_fusion import estimate_uwb_gnss_fusion
from swarmfix.models.measurements import GnssMeasurement, MeasurementSet, UwbRangeMeasurement


def _parity_measurements() -> MeasurementSet:
    """Build a deterministic fixture shared by Python and C parity tests."""
    measurements = MeasurementSet(
        gnss=[
            GnssMeasurement(agent_id="a", position_m=(0.2, -0.1, 0.0), sigma_m=1.0),
            GnssMeasurement(agent_id="b", position_m=(4.1, 0.2, 0.0), sigma_m=1.0),
            GnssMeasurement(agent_id="c", position_m=(-0.1, 3.2, 0.0), sigma_m=1.0),
        ],
        uwb=[
            UwbRangeMeasurement(source_id="a", target_id="b", distance_m=4.0, sigma_m=0.1),
            UwbRangeMeasurement(source_id="a", target_id="c", distance_m=3.0, sigma_m=0.1),
            UwbRangeMeasurement(source_id="b", target_id="c", distance_m=5.0, sigma_m=0.1),
        ],
    )
    return measurements


def test_c_backend_selection_fails_clearly_when_library_is_missing(tmp_path,
                                                                   monkeypatch) -> None:
    from swarmfix.estimation.backends.c_solver import CSolverUnavailableError
    from swarmfix.estimation.backends.c_solver import load_c_solver_backend

    missing_library = tmp_path / "missing-swarmfix-solver.dll"
    monkeypatch.setenv("SWARMFIX_C_SOLVER_LIBRARY", str(missing_library))

    with pytest.raises(CSolverUnavailableError, match="C solver library"):
        load_c_solver_backend()


def test_solver_registry_routes_c_backend_to_native_loader(tmp_path,
                                                           monkeypatch) -> None:
    from swarmfix.estimation.backends.c_solver import CSolverUnavailableError
    from swarmfix.estimation.solver_backend import get_solver_backend

    missing_library = tmp_path / "missing-swarmfix-solver.dll"
    monkeypatch.setenv("SWARMFIX_C_SOLVER_LIBRARY", str(missing_library))

    with pytest.raises(CSolverUnavailableError, match="C solver library"):
        get_solver_backend("c-uwb-gnss")


def test_default_backend_fails_clearly_when_c_library_is_missing(tmp_path,
                                                                 monkeypatch) -> None:
    from swarmfix.estimation.backends.c_solver import CSolverUnavailableError
    from swarmfix.estimation.solver_backend import get_solver_backend

    missing_library = tmp_path / "missing-default-swarmfix-solver.dll"
    monkeypatch.setenv("SWARMFIX_C_SOLVER_LIBRARY", str(missing_library))

    with pytest.raises(CSolverUnavailableError, match="C solver library"):
        get_solver_backend()


def test_native_c_solver_layout_exists_for_optional_backend() -> None:
    repo_root = Path(__file__).resolve().parents[1]

    assert (repo_root / "native" / "uwb_gnss_solver" / "include"
            / "swarmfix_uwb_gnss_solver.h").is_file()
    assert (repo_root / "native" / "uwb_gnss_solver" / "src"
            / "swarmfix_uwb_gnss_solver.c").is_file()
    assert (repo_root / "native" / "uwb_gnss_solver" / "CMakeLists.txt").is_file()


def test_c_backend_matches_python_reference_when_native_library_is_available() -> None:
    from swarmfix.estimation.backends.c_solver import CSolverUnavailableError
    from swarmfix.estimation.solver_backend import get_solver_backend

    measurements = _parity_measurements()
    try:
        c_backend = get_solver_backend("c-uwb-gnss")
    except CSolverUnavailableError as error:
        pytest.skip(f"C solver library is not built locally: {error}")

    c_estimates, c_trace = c_backend.solve(
        measurements,
        max_iterations=60,
        robust_loss="linear",
    )
    python_estimates, python_trace = estimate_uwb_gnss_fusion(
        measurements,
        max_iterations=60,
        robust_loss="linear",
    )

    for estimate in python_estimates.estimates:
        c_position = c_estimates.position_for(estimate.agent_id)
        assert c_position == pytest.approx(estimate.position_m, abs=1e-3)
    assert c_trace.iterations[-1].cost_total == pytest.approx(
        python_trace.iterations[-1].cost_total,
        abs=1e-3,
    )
