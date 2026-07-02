"""Named solver backend boundary for UWB/GNSS fusion."""

from __future__ import annotations

from typing import Protocol

from swarmfix.models.estimates import EstimateSet
from swarmfix.models.measurements import MeasurementSet
from swarmfix.models.residuals import SolverTrace


DEFAULT_SOLVER_BACKEND_NAME = "c-uwb-gnss"


class SolverBackend(Protocol):
    """Backend capable of solving one weighted UWB/GNSS fusion problem."""

    name: str

    def solve(self,
              measurements: MeasurementSet,
              max_iterations: int = 100,
              robust_loss: str = "linear") -> tuple[EstimateSet, SolverTrace]:
        """Return fused estimates and a solver trace for the given measurements."""


def _python_backend() -> SolverBackend:
    """Construct the Python reference solver backend without importing C adapters."""
    from swarmfix.estimation.backends.python_scipy import PythonScipySolverBackend

    backend = PythonScipySolverBackend()
    return backend


def available_solver_backend_names() -> tuple[str, ...]:
    """Return backends that are available without optional native artifacts."""
    backend_names = ("python-scipy",)
    return backend_names


def get_solver_backend(name: str | None = None) -> SolverBackend:
    """Return a configured solver backend by name.

    The default backend is the native C solver. The Python backend remains
    available by explicit name for parity checks and development environments.
    """
    backend_name = name or DEFAULT_SOLVER_BACKEND_NAME
    if backend_name == "python-scipy":
        backend = _python_backend()
        return backend

    if backend_name == "c-uwb-gnss":
        from swarmfix.estimation.backends.c_solver import load_c_solver_backend

        backend = load_c_solver_backend()
        return backend

    available_names = ", ".join(("python-scipy", "c-uwb-gnss"))
    raise ValueError(
        f"unknown solver backend '{backend_name}'. Available backends: {available_names}"
    )
