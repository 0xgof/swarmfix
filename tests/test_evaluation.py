"""Tests for SwarmFix evaluation modules."""

import math

import pytest


def test_metrics_separate_absolute_translation_from_relative_shape() -> None:
    from swarmfix.evaluation.metrics import (
        absolute_mae,
        absolute_rmse,
        centroid_error,
        max_error,
        pairwise_distance_errors,
        relative_rmse,
    )
    from swarmfix.models.estimates import EstimateSet, PositionEstimate
    from swarmfix.scenarios.formations import make_square_formation

    scenario = make_square_formation(spacing_m=5.0)
    translated = EstimateSet(
        method="translated",
        estimates=[
            PositionEstimate(
                agent_id=agent.agent_id,
                position_m=(agent.position_m[0] + 2.0, agent.position_m[1] - 1.0),
            )
            for agent in scenario.agents
        ],
    )

    assert absolute_rmse(scenario, translated) == pytest.approx(math.sqrt(5.0))
    assert absolute_mae(scenario, translated) == pytest.approx(math.sqrt(5.0))
    assert max_error(scenario, translated) == pytest.approx(math.sqrt(5.0))
    assert centroid_error(scenario, translated) == pytest.approx(math.sqrt(5.0))
    assert relative_rmse(scenario, translated) == pytest.approx(0.0)
    assert pairwise_distance_errors(scenario, translated) == pytest.approx([0.0] * 6)


def test_metrics_reject_mismatched_agent_ids() -> None:
    from swarmfix.evaluation.metrics import absolute_rmse
    from swarmfix.models.estimates import EstimateSet, PositionEstimate
    from swarmfix.scenarios.formations import make_square_formation

    scenario = make_square_formation(spacing_m=5.0)
    bad_estimate = EstimateSet(
        method="bad",
        estimates=[PositionEstimate(agent_id="robot_0", position_m=(0.0, 0.0))],
    )

    with pytest.raises(ValueError):
        absolute_rmse(scenario, bad_estimate)


def test_orientation_error_ignores_translation_and_measures_rotation() -> None:
    from swarmfix.evaluation.metrics import orientation_error
    from swarmfix.models.estimates import EstimateSet, PositionEstimate
    from swarmfix.scenarios.formations import make_square_formation

    scenario = make_square_formation(spacing_m=5.0)
    translated = EstimateSet(
        method="translated",
        estimates=[
            PositionEstimate(
                agent_id=agent.agent_id,
                position_m=(agent.position_m[0] + 3.0, agent.position_m[1] - 2.0),
            )
            for agent in scenario.agents
        ],
    )
    rotated = EstimateSet(
        method="rotated",
        estimates=[
            PositionEstimate(
                agent_id=agent.agent_id,
                position_m=(-agent.position_m[1], agent.position_m[0]),
            )
            for agent in scenario.agents
        ],
    )

    assert orientation_error(scenario, translated) == pytest.approx(0.0)
    assert orientation_error(scenario, rotated) == pytest.approx(math.pi / 2.0)


def test_bias_estimation_error_reports_vector_and_norm_when_expected_bias_exists() -> None:
    from swarmfix.evaluation.metrics import bias_estimation_error

    exact = bias_estimation_error(
        estimated_bias_m=(1.5, -0.8),
        expected_bias_m=(1.5, -0.8),
    )
    offset = bias_estimation_error(
        estimated_bias_m=(1.0, -1.0),
        expected_bias_m=(1.5, -0.8),
    )

    assert exact["bias_error_norm"] == pytest.approx(0.0)
    assert offset["bias_error_x"] == pytest.approx(-0.5)
    assert offset["bias_error_y"] == pytest.approx(-0.2)
    assert offset["bias_error_norm"] == pytest.approx(math.sqrt(0.29))

    with pytest.raises(ValueError, match="dimension"):
        bias_estimation_error(estimated_bias_m=(1.0,), expected_bias_m=(1.0, 2.0))


def test_comparison_summaries_handle_missing_optionals_and_zero_baseline() -> None:
    from swarmfix.evaluation.comparisons import compare_estimates
    from swarmfix.models.estimates import EstimateSet, PositionEstimate
    from swarmfix.models.residuals import SolverIterationTrace, SolverTrace
    from swarmfix.scenarios.formations import make_square_formation

    scenario = make_square_formation(spacing_m=5.0)
    perfect = EstimateSet(
        method="gnss_only",
        estimates=[
            PositionEstimate(agent_id=agent.agent_id, position_m=agent.position_m)
            for agent in scenario.agents
        ],
    )

    summaries = compare_estimates(scenario, {"gnss_only": perfect})
    trace = SolverTrace(
        trace_type="residual_evaluation",
        iterations=[
            SolverIterationTrace(iteration=0, positions={}, cost_total=10.0),
            SolverIterationTrace(iteration=1, positions={}, cost_total=4.0),
        ],
    )
    trace_summaries = compare_estimates(
        scenario,
        {"candidate": perfect},
        solver_trace=trace,
    )

    assert summaries["gnss_only"].values["absolute_rmse"] == pytest.approx(0.0)
    assert summaries["gnss_only"].values["absolute_rmse_improvement"] == pytest.approx(0.0)
    assert "absolute_rmse_improvement" not in trace_summaries["candidate"].values
    assert trace_summaries["candidate"].values["solver_cost_reduction"] == pytest.approx(0.6)


def test_comparison_summaries_flag_common_bias_failure_and_bias_quality() -> None:
    from swarmfix.evaluation.comparisons import compare_estimates
    from swarmfix.models.estimates import EstimateSet, PositionEstimate
    from swarmfix.scenarios.formations import make_square_formation

    scenario = make_square_formation(spacing_m=5.0)
    shifted = EstimateSet(
        method="fused",
        estimates=[
            PositionEstimate(
                agent_id=agent.agent_id,
                position_m=(agent.position_m[0] + 2.0, agent.position_m[1]),
            )
            for agent in scenario.agents
        ],
    )
    corrected = EstimateSet(
        method="corrected",
        estimates=[
            PositionEstimate(agent_id=agent.agent_id, position_m=agent.position_m)
            for agent in scenario.agents
        ],
        metadata={"estimated_bias_m_0": 2.0, "estimated_bias_m_1": 0.0},
    )

    no_reference_summary = compare_estimates(
        scenario,
        {"fused": shifted},
        reference_available=False,
    )["fused"].values
    reference_summary = compare_estimates(
        scenario,
        {"corrected": corrected},
        reference_available=True,
        expected_common_bias_m=(2.0, 0.0),
    )["corrected"].values

    assert no_reference_summary["common_bias_observable"] == pytest.approx(0.0)
    assert no_reference_summary["common_bias_failure_flag"] == pytest.approx(1.0)
    assert no_reference_summary["absolute_error_remaining"] == pytest.approx(2.0)
    assert no_reference_summary["relative_error_after_fusion"] == pytest.approx(0.0)
    assert reference_summary["common_bias_observable"] == pytest.approx(1.0)
    assert reference_summary["bias_error_norm"] == pytest.approx(0.0)
