"""Python scipy solver backend for UWB/GNSS fusion."""

from __future__ import annotations

from swarmfix.estimation.uwb_gnss_fusion import estimate_uwb_gnss_fusion
from swarmfix.models.estimates import EstimateSet
from swarmfix.models.measurements import MeasurementSet
from swarmfix.models.residuals import SolverTrace


class PythonScipySolverBackend:
    """Reference backend that delegates to the existing scipy implementation."""

    name = "python-scipy"

    def solve(self,
              measurements: MeasurementSet,
              max_iterations: int = 100,
              robust_loss: str = "linear") -> tuple[EstimateSet, SolverTrace]:
        """Fuse measurements using the repository's Python reference solver."""
        solve_result = estimate_uwb_gnss_fusion(
            measurements,
            max_iterations=max_iterations,
            robust_loss=robust_loss,
        )
        return solve_result
