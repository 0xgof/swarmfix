"""Named workflow steps for the SwarmFix pipeline."""

from __future__ import annotations

from swarmfix.estimation.gnss_only import estimate_gnss_only
from swarmfix.estimation.mission_bias_correction import apply_mission_bias_correction
from swarmfix.estimation.uwb_gnss_fusion import estimate_uwb_gnss_fusion
from swarmfix.evaluation.comparisons import compare_estimates
from swarmfix.models.measurements import MeasurementSet
from swarmfix.models.results import PipelineResult
from swarmfix.scenarios.build_scenario import build_scenario
from swarmfix.sensors.gnss import simulate_gnss
from swarmfix.sensors.reference import simulate_reference
from swarmfix.sensors.uwb import simulate_uwb


def build_pipeline_result(config) -> PipelineResult:
    """Run all static MVP pipeline steps and return typed results."""
    scenario = build_scenario(config)
    gnss_measurements = simulate_gnss(
        scenario,
        sigma_m=config.gnss.sigma_m,
        common_bias_m=config.gnss.common_bias_m,
        independent_sigma_m=config.gnss.independent_sigma_m,
        seed=config.seed,
        outlier_probability=config.gnss.outlier_probability,
        outlier_sigma_m=config.gnss.outlier_sigma_m,
        spatial_correlation_enabled=config.gnss.spatial_correlation_enabled,
        spatial_correlation_length_m=config.gnss.spatial_correlation_length_m,
        spatial_correlation_sigma_m=config.gnss.spatial_correlation_sigma_m,
    )
    uwb_measurements = simulate_uwb(
        scenario,
        sigma_m=config.uwb.sigma_m,
        seed=config.seed,
        max_range_m=config.uwb.max_range_m,
        missing_link_probability=config.uwb.missing_link_probability,
        nlos_probability=config.uwb.nlos_probability,
        nlos_positive_bias_m=config.uwb.nlos_positive_bias_m,
    ) if config.uwb.enabled else MeasurementSet()
    reference_measurements = simulate_reference(
        scenario,
        enabled=config.reference.enabled,
        reference_type=config.reference.type,
        agent_id=config.reference.agent_id,
        position_m=config.reference.position_m,
        sigma_m=config.reference.sigma_m,
    )
    measurements = MeasurementSet(
        gnss=gnss_measurements.gnss,
        uwb=uwb_measurements.uwb,
        references=reference_measurements.references,
    )
    gnss_only = estimate_gnss_only(measurements)
    fused, solver_trace = estimate_uwb_gnss_fusion(
        measurements,
        max_iterations=config.estimation.max_iterations,
        robust_loss=config.estimation.robust_loss,
    )
    estimates = {"gnss_only": gnss_only, "fused": fused}
    if reference_measurements.references:
        estimates["corrected"] = apply_mission_bias_correction(fused, reference_measurements)
    metrics = compare_estimates(
        scenario,
        estimates,
        solver_trace=solver_trace,
        reference_available=bool(reference_measurements.references),
        expected_common_bias_m=config.gnss.common_bias_m,
    )
    pipeline_result = PipelineResult(
        scenario=scenario,
        measurements=measurements,
        estimates=estimates,
        metrics=metrics,
        solver_trace=solver_trace,
    )
    return pipeline_result
