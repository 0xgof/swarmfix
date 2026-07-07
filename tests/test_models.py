"""Tests for shared SwarmFix model contracts."""

import math

import pytest


def test_scenario_rejects_duplicate_agents_and_bad_topology_edges() -> None:
    from swarmfix.models.scenario import AgentState, Scenario, TopologyEdge, TopologyGraph

    with pytest.raises(ValueError, match="agent_id"):
        AgentState(agent_id="", position_m=(0.0, 0.0))

    with pytest.raises(ValueError, match="endpoints"):
        TopologyEdge(source_id="robot_0", target_id="robot_0", distance_m=1.0)

    with pytest.raises(ValueError, match="positive"):
        TopologyEdge(source_id="robot_0", target_id="robot_1", distance_m=0.0)

    agents = [
        AgentState(agent_id="robot_0", position_m=(0.0, 0.0)),
        AgentState(agent_id="robot_0", position_m=(1.0, 0.0)),
    ]

    with pytest.raises(ValueError):
        Scenario(name="bad", dimension=2, agents=agents)

    good_agents = [
        AgentState(agent_id="robot_0", position_m=(0.0, 0.0)),
        AgentState(agent_id="robot_1", position_m=(1.0, 0.0)),
    ]
    bad_topology = TopologyGraph(
        edges=[TopologyEdge(source_id="robot_0", target_id="missing", distance_m=1.0)]
    )

    with pytest.raises(ValueError):
        Scenario(name="bad_edge", dimension=2, agents=good_agents, topology=bad_topology)

    with pytest.raises(ValueError, match="dimension"):
        Scenario(name="bad_dimension", dimension=4, agents=good_agents)

    with pytest.raises(ValueError, match="position dimension"):
        Scenario(name="bad_position", dimension=2, agents=[
            AgentState(agent_id="robot_0", position_m=(0.0, 0.0, 0.0)),
        ])


def test_scenario_position_lookup_and_distance_use_agent_ids() -> None:
    from swarmfix.models.scenario import AgentState, Scenario

    scenario = Scenario(
        name="lookup",
        dimension=2,
        agents=[
            AgentState(agent_id="robot_0", position_m=(0.0, 0.0)),
            AgentState(agent_id="robot_1", position_m=(3.0, 4.0)),
        ],
    )

    assert scenario.agent_position("robot_1") == (3.0, 4.0)
    assert scenario.true_distance("robot_0", "robot_1") == pytest.approx(5.0)

    with pytest.raises(KeyError):
        scenario.agent_position("missing")


def test_measurements_require_uncertainty_and_valid_uwb_edges() -> None:
    from swarmfix.models.measurements import (
        GnssMeasurement,
        ReferenceMeasurement,
        UwbRangeMeasurement,
    )

    with pytest.raises(ValueError):
        GnssMeasurement(agent_id="robot_0", position_m=(0.0, 0.0), sigma_m=0.0)

    with pytest.raises(ValueError):
        UwbRangeMeasurement(
            source_id="robot_0",
            target_id="robot_0",
            distance_m=1.0,
            sigma_m=0.1,
        )

    with pytest.raises(ValueError):
        UwbRangeMeasurement(
            source_id="robot_0",
            target_id="robot_1",
            distance_m=-1.0,
            sigma_m=0.1,
        )

    with pytest.raises(ValueError):
        UwbRangeMeasurement(
            source_id="robot_0",
            target_id="robot_1",
            distance_m=1.0,
            sigma_m=0.0,
        )

    with pytest.raises(ValueError):
        ReferenceMeasurement(agent_id="robot_0", position_m=(0.0, 0.0), sigma_m=-0.1)


def test_estimates_residuals_metrics_noise_and_results_preserve_contract_data() -> None:
    from swarmfix.models.estimates import EstimateSet, PositionEstimate
    from swarmfix.models.measurements import GnssMeasurement, MeasurementSet
    from swarmfix.models.metrics import MetricsSummary
    from swarmfix.models.noise import GnssNoiseModel, UwbNoiseModel
    from swarmfix.models.residuals import (
        GnssResidual,
        ReferenceResidual,
        SolverIterationTrace,
        SolverTrace,
        UwbResidual,
    )
    from swarmfix.models.results import ExperimentResult, PipelineResult
    from swarmfix.scenarios.formations import make_square_formation

    scenario = make_square_formation(spacing_m=5.0)
    estimate_set = EstimateSet(
        method="manual",
        estimates=[
            PositionEstimate(agent_id=agent.agent_id, position_m=agent.position_m)
            for agent in scenario.agents
        ],
    )
    measurements = MeasurementSet(
        gnss=[GnssMeasurement(agent_id="robot_0", position_m=(0.2, 0.1), sigma_m=2.0)]
    )
    residual = GnssResidual(
        agent_id="robot_0",
        vector=(0.2, 0.1),
        norm=math.sqrt(0.05),
        weighted_sq=0.0125,
    )
    trace = SolverTrace(
        trace_type="residual_evaluation",
        iterations=[
            SolverIterationTrace(
                iteration=0,
                positions={"robot_0": (0.0, 0.0)},
                cost_total=0.0125,
                cost_gnss=0.0125,
                gnss_residuals=[residual],
                uwb_residuals=[
                    UwbResidual(
                        source_id="robot_0",
                        target_id="robot_1",
                        residual_m=0.1,
                        weighted_sq=1.0,
                    ),
                ],
                reference_residuals=[
                    ReferenceResidual(
                        agent_id="robot_0",
                        vector=(0.0, 0.0),
                        norm=0.0,
                        weighted_sq=0.0,
                    ),
                ],
            )
        ],
    )
    result = PipelineResult(
        scenario=scenario,
        measurements=measurements,
        estimates={"manual": estimate_set},
        metrics={"manual": MetricsSummary(method="manual", values={"absolute_rmse": 0.0})},
        solver_trace=trace,
    )
    experiment = ExperimentResult(name="contract", pipeline_result=result)

    assert estimate_set.position_for("robot_3") == (5.0, 5.0)
    assert estimate_set.as_position_map()["robot_0"] == (0.0, 0.0)
    assert result.solver_trace.iterations[0].gnss_residuals[0].weighted_sq == pytest.approx(0.0125)
    assert experiment.pipeline_result.metrics["manual"].values["absolute_rmse"] == pytest.approx(0.0)
    assert GnssNoiseModel(
        sigma_m=2.0,
        common_bias_m=(1.0, 0.0),
        independent_sigma_m=0.4,
    ).sigma_m == 2.0
    assert UwbNoiseModel(sigma_m=0.1, max_range_m=10.0).max_range_m == 10.0

    with pytest.raises(KeyError):
        estimate_set.position_for("missing")


def test_noise_models_reject_invalid_uncertainty_values() -> None:
    from pydantic import ValidationError

    from swarmfix.models.noise import GnssNoiseModel, UwbNoiseModel

    with pytest.raises(ValidationError, match="sigma"):
        GnssNoiseModel(
            sigma_m=0.0,
            common_bias_m=(0.0, 0.0),
            independent_sigma_m=0.0,
        )

    with pytest.raises(ValidationError, match="independent"):
        GnssNoiseModel(
            sigma_m=1.0,
            common_bias_m=(0.0, 0.0),
            independent_sigma_m=-0.1,
        )

    with pytest.raises(ValidationError, match="sigma"):
        UwbNoiseModel(sigma_m=0.0)

    with pytest.raises(ValidationError, match="max_range"):
        UwbNoiseModel(sigma_m=0.1, max_range_m=-1.0)
