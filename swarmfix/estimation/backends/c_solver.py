"""ctypes adapter for the optional native UWB/GNSS solver backend."""

from __future__ import annotations

import ctypes
import math
import os
import sys
from pathlib import Path

import numpy as np

from swarmfix.estimation.uwb_gnss_fusion import build_weighted_residuals
from swarmfix.models.estimates import EstimateSet, PositionEstimate
from swarmfix.models.measurements import MeasurementSet
from swarmfix.models.residuals import SolverTrace


ABI_VERSION = 1
BACKEND_NAME = "c-uwb-gnss"


class CSolverUnavailableError(RuntimeError):
    """Raised when the C solver backend is selected but cannot be loaded."""


class CSolverSolveError(RuntimeError):
    """Raised when the native solver reports an unsuccessful solve."""


class _CSolverProblem(ctypes.Structure):
    """ctypes mirror of ``SwarmfixUwbGnssProblem`` from the C header."""

    _fields_ = [
        ("agent_count", ctypes.c_int),
        ("dimension", ctypes.c_int),
        ("uwb_count", ctypes.c_int),
        ("max_iterations", ctypes.c_int),
        ("gnss_positions", ctypes.POINTER(ctypes.c_double)),
        ("gnss_sigmas", ctypes.POINTER(ctypes.c_double)),
        ("uwb_source_indices", ctypes.POINTER(ctypes.c_int)),
        ("uwb_target_indices", ctypes.POINTER(ctypes.c_int)),
        ("uwb_distances", ctypes.POINTER(ctypes.c_double)),
        ("uwb_sigmas", ctypes.POINTER(ctypes.c_double)),
        ("output_positions", ctypes.POINTER(ctypes.c_double)),
        ("output_cost_total", ctypes.POINTER(ctypes.c_double)),
        ("output_cost_gnss", ctypes.POINTER(ctypes.c_double)),
        ("output_cost_uwb", ctypes.POINTER(ctypes.c_double)),
        ("output_iterations", ctypes.POINTER(ctypes.c_int)),
    ]


def _repo_root() -> Path:
    """Return the repository root from the adapter module location."""
    root = Path(__file__).resolve().parents[3]
    return root


def _default_library_candidates() -> list[Path]:
    """Return native library paths searched when no env override is provided."""
    build_root = _repo_root() / "native" / "uwb_gnss_solver" / "build"
    if sys.platform.startswith("win"):
        filenames = ["swarmfix_uwb_gnss_solver.dll"]
        subdirs = [Path("Release"), Path("Debug"), Path(".")]
    elif sys.platform == "darwin":
        filenames = ["libswarmfix_uwb_gnss_solver.dylib"]
        subdirs = [Path(".")]
    else:
        filenames = ["libswarmfix_uwb_gnss_solver.so"]
        subdirs = [Path(".")]

    candidates = [
        build_root / subdir / filename
        for subdir in subdirs
        for filename in filenames
    ]
    return candidates


def _configured_library_path(library_path: str | Path | None = None) -> Path | None:
    """Return the explicitly configured native library path, if any."""
    if library_path is not None:
        configured_path = Path(library_path)
        return configured_path

    env_path = os.environ.get("SWARMFIX_C_SOLVER_LIBRARY")
    if env_path:
        configured_path = Path(env_path)
        return configured_path

    return None


def _find_library_path(library_path: str | Path | None = None) -> Path:
    """Resolve the native library path or raise a clear backend error."""
    configured_path = _configured_library_path(library_path)
    if configured_path is not None:
        if configured_path.is_file():
            return configured_path
        raise CSolverUnavailableError(f"C solver library not found: {configured_path}")

    for candidate in _default_library_candidates():
        if candidate.is_file():
            return candidate

    searched_paths = ", ".join(str(candidate) for candidate in _default_library_candidates())
    raise CSolverUnavailableError(
        "C solver library is not built. Set SWARMFIX_C_SOLVER_LIBRARY or build one of: "
        f"{searched_paths}"
    )


def _configure_library(library: ctypes.CDLL, library_path: Path) -> None:
    """Configure ctypes signatures and check the native ABI version."""
    try:
        library.swarmfix_uwb_gnss_abi_version.argtypes = []
        library.swarmfix_uwb_gnss_abi_version.restype = ctypes.c_int
        native_abi = library.swarmfix_uwb_gnss_abi_version()
    except AttributeError as error:
        raise CSolverUnavailableError(
            f"C solver library is missing ABI version function: {library_path}"
        ) from error

    if native_abi != ABI_VERSION:
        raise CSolverUnavailableError(
            f"C solver ABI mismatch: expected {ABI_VERSION}, got {native_abi}"
        )

    try:
        library.swarmfix_solve_uwb_gnss.argtypes = [
            ctypes.POINTER(_CSolverProblem),
        ]
        library.swarmfix_solve_uwb_gnss.restype = ctypes.c_int
        library.swarmfix_uwb_gnss_status_message.argtypes = [ctypes.c_int]
        library.swarmfix_uwb_gnss_status_message.restype = ctypes.c_char_p
    except AttributeError as error:
        raise CSolverUnavailableError(
            f"C solver library is missing required solve symbols: {library_path}"
        ) from error


def _agent_ids(measurements: MeasurementSet) -> list[str]:
    """Return deterministic agent ids from GNSS measurements."""
    agent_ids = [measurement.agent_id for measurement in measurements.gnss]
    if not agent_ids:
        raise ValueError("fusion requires GNSS measurements")
    if len(agent_ids) != len(set(agent_ids)):
        raise ValueError("duplicate GNSS measurement agent IDs")
    return agent_ids


def _dimension(measurements: MeasurementSet) -> int:
    """Return and validate the shared position dimension."""
    dimension = len(measurements.gnss[0].position_m)
    for measurement in measurements.gnss:
        if len(measurement.position_m) != dimension:
            raise ValueError("GNSS measurement dimensions must match")
    return dimension


def _ctypes_double_array(values: list[float]) -> ctypes.Array:
    """Create a ctypes double array while supporting empty UWB arrays."""
    array_length = max(len(values), 1)
    array_type = ctypes.c_double * array_length
    padded_values = values if values else [0.0]
    double_array = array_type(*padded_values)
    return double_array


def _ctypes_int_array(values: list[int]) -> ctypes.Array:
    """Create a ctypes int array while supporting empty UWB arrays."""
    array_length = max(len(values), 1)
    array_type = ctypes.c_int * array_length
    padded_values = values if values else [0]
    int_array = array_type(*padded_values)
    return int_array


class CTypesUwbGnssSolverBackend:
    """Native C backend loaded through ctypes."""

    name = BACKEND_NAME

    def __init__(self, library_path: str | Path | None = None) -> None:
        resolved_path = _find_library_path(library_path)
        try:
            library = ctypes.CDLL(str(resolved_path))
        except OSError as error:
            raise CSolverUnavailableError(
                f"C solver library could not be loaded: {resolved_path}"
            ) from error

        _configure_library(library, resolved_path)
        self._library = library
        self.library_path = resolved_path

    def solve(self,
              measurements: MeasurementSet,
              max_iterations: int = 100,
              robust_loss: str = "linear") -> tuple[EstimateSet, SolverTrace]:
        """Solve one weighted fusion problem with the native library."""
        if robust_loss != "linear":
            raise ValueError("C solver backend currently supports only linear robust_loss")

        agent_ids = _agent_ids(measurements)
        dimension = _dimension(measurements)
        agent_index = {agent_id: index for index, agent_id in enumerate(agent_ids)}
        position_count = len(agent_ids) * dimension
        gnss_positions = [
            coordinate
            for measurement in measurements.gnss
            for coordinate in measurement.position_m
        ]
        gnss_sigmas = [measurement.sigma_m for measurement in measurements.gnss]
        source_indices: list[int] = []
        target_indices: list[int] = []
        uwb_distances: list[float] = []
        uwb_sigmas: list[float] = []

        for measurement in measurements.uwb:
            if measurement.source_id not in agent_index or measurement.target_id not in agent_index:
                raise ValueError("UWB endpoint is missing from GNSS measurements")
            source_indices.append(agent_index[measurement.source_id])
            target_indices.append(agent_index[measurement.target_id])
            uwb_distances.append(measurement.distance_m)
            uwb_sigmas.append(measurement.sigma_m)

        gnss_position_array = _ctypes_double_array(gnss_positions)
        gnss_sigma_array = _ctypes_double_array(gnss_sigmas)
        source_index_array = _ctypes_int_array(source_indices)
        target_index_array = _ctypes_int_array(target_indices)
        uwb_distance_array = _ctypes_double_array(uwb_distances)
        uwb_sigma_array = _ctypes_double_array(uwb_sigmas)
        output_array_type = ctypes.c_double * position_count
        output_positions = output_array_type(*([0.0] * position_count))
        output_cost_total = ctypes.c_double(0.0)
        output_cost_gnss = ctypes.c_double(0.0)
        output_cost_uwb = ctypes.c_double(0.0)
        output_iterations = ctypes.c_int(0)

        problem = _CSolverProblem(
            agent_count=len(agent_ids),
            dimension=dimension,
            uwb_count=len(measurements.uwb),
            max_iterations=max_iterations,
            gnss_positions=gnss_position_array,
            gnss_sigmas=gnss_sigma_array,
            uwb_source_indices=source_index_array,
            uwb_target_indices=target_index_array,
            uwb_distances=uwb_distance_array,
            uwb_sigmas=uwb_sigma_array,
            output_positions=output_positions,
            output_cost_total=ctypes.pointer(output_cost_total),
            output_cost_gnss=ctypes.pointer(output_cost_gnss),
            output_cost_uwb=ctypes.pointer(output_cost_uwb),
            output_iterations=ctypes.pointer(output_iterations),
        )
        status = self._library.swarmfix_solve_uwb_gnss(ctypes.byref(problem))
        if status != 0:
            status_message = self._status_message(status)
            raise CSolverSolveError(
                f"C solver failed with status {status}: {status_message}"
            )

        position_vector = np.asarray(list(output_positions), dtype=float)
        if not np.all(np.isfinite(position_vector)):
            raise CSolverSolveError("C solver returned non-finite positions")

        estimates = []
        for index, agent_id in enumerate(agent_ids):
            start = index * dimension
            stop = start + dimension
            position = tuple(float(coordinate) for coordinate in position_vector[start:stop])
            if any(not math.isfinite(coordinate) for coordinate in position):
                raise CSolverSolveError("C solver returned non-finite coordinates")
            estimates.append(PositionEstimate(agent_id=agent_id, position_m=position))

        _residual_vector, final_iteration = build_weighted_residuals(
            position_vector,
            agent_ids,
            dimension,
            measurements,
            iteration=0,
        )
        estimate_set = EstimateSet(
            method="uwb_gnss_fusion",
            estimates=estimates,
            metadata={
                "solver_backend": self.name,
                "native_iterations": int(output_iterations.value),
            },
        )
        solver_trace = SolverTrace(
            trace_type="residual_evaluation",
            iterations=[final_iteration],
        )
        return estimate_set, solver_trace

    def _status_message(self, status: int) -> str:
        """Return a native status message when the library exposes one."""
        raw_message = self._library.swarmfix_uwb_gnss_status_message(status)
        if raw_message is None:
            return "unknown status"
        message = raw_message.decode("utf-8", errors="replace")
        return message


def load_c_solver_backend(library_path: str | Path | None = None) -> CTypesUwbGnssSolverBackend:
    """Load the optional C backend or raise a clear availability error."""
    backend = CTypesUwbGnssSolverBackend(library_path=library_path)
    return backend
