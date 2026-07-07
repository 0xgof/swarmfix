"""Tests for SwarmFix estimation modules."""

import numpy as np
import pytest


def test_gnss_only_baseline_returns_measurements_unchanged() -> None:
    from swarmfix.estimation.gnss_only import estimate_gnss_only
    from swarmfix.models.measurements import GnssMeasurement, MeasurementSet

    measurements = MeasurementSet(
        gnss=[GnssMeasurement(agent_id="robot_0", position_m=(1.0, 2.0), sigma_m=2.0)]
    )
    estimate_set = estimate_gnss_only(measurements)

    assert estimate_set.method == "gnss_only"
    assert estimate_set.position_for("robot_0") == (1.0, 2.0)

    with pytest.raises(ValueError):
        estimate_gnss_only(MeasurementSet())


def test_rigid_topology_fit_recovers_rotated_translated_square_without_scale() -> None:
    from swarmfix.estimation.rigid_topology_fit import estimate_rigid_topology_fit
    from swarmfix.models.measurements import GnssMeasurement, MeasurementSet
    from swarmfix.scenarios.formations import make_square_formation

    scenario = make_square_formation(spacing_m=5.0)
    measured_positions = {
        "robot_0": (10.0, -3.0),
        "robot_1": (10.0, 2.0),
        "robot_2": (5.0, -3.0),
        "robot_3": (5.0, 2.0),
    }
    measurements = MeasurementSet(
        gnss=[
            GnssMeasurement(agent_id=agent_id, position_m=position, sigma_m=1.0)
            for agent_id, position in measured_positions.items()
        ]
    )
    estimate_set = estimate_rigid_topology_fit(scenario, measurements)

    assert estimate_set.method == "rigid_topology_fit"
    assert estimate_set.position_for("robot_0") == pytest.approx((10.0, -3.0))
    assert estimate_set.position_for("robot_3") == pytest.approx((5.0, 2.0))

    bad_measurements = MeasurementSet(
        gnss=[
            GnssMeasurement(agent_id="robot_0", position_m=(10.0, -3.0), sigma_m=1.0),
        ]
    )
    with pytest.raises(ValueError, match="agent IDs"):
        estimate_rigid_topology_fit(scenario, bad_measurements)


def test_rigid_topology_fit_rejects_non_2d_scenarios() -> None:
    from swarmfix.estimation.rigid_topology_fit import estimate_rigid_topology_fit
    from swarmfix.models.measurements import GnssMeasurement, MeasurementSet
    from swarmfix.models.scenario import AgentState, Scenario

    scenario = Scenario(
        name="three_d",
        dimension=3,
        agents=[
            AgentState(agent_id="robot_0", position_m=(0.0, 0.0, 0.0)),
            AgentState(agent_id="robot_1", position_m=(1.0, 0.0, 0.0)),
        ],
    )
    measurements = MeasurementSet(
        gnss=[
            GnssMeasurement(agent_id="robot_0", position_m=(0.0, 0.0, 0.0), sigma_m=1.0),
            GnssMeasurement(agent_id="robot_1", position_m=(1.0, 0.0, 0.0), sigma_m=1.0),
        ]
    )

    with pytest.raises(ValueError, match="2D"):
        estimate_rigid_topology_fit(scenario, measurements)


def test_weighted_residual_builder_matches_numeric_objective_terms() -> None:
    from swarmfix.estimation.uwb_gnss_fusion import build_weighted_residuals
    from swarmfix.models.measurements import GnssMeasurement, MeasurementSet, UwbRangeMeasurement

    measurements = MeasurementSet(
        gnss=[
            GnssMeasurement(agent_id="robot_0", position_m=(0.0, 0.0), sigma_m=2.0),
            GnssMeasurement(agent_id="robot_1", position_m=(4.0, 0.0), sigma_m=2.0),
        ],
        uwb=[
            UwbRangeMeasurement(
                source_id="robot_0",
                target_id="robot_1",
                distance_m=5.0,
                sigma_m=0.5,
            ),
        ],
    )

    residual_vector, trace = build_weighted_residuals(
        np.asarray([0.0, 0.0, 4.5, 0.0]),
        ["robot_0", "robot_1"],
        2,
        measurements,
    )

    assert residual_vector.tolist() == pytest.approx([0.0, 0.0, 0.25, 0.0, -1.0])
    assert trace.gnss_residuals[1].weighted_sq == pytest.approx(0.0625)
    assert trace.uwb_residuals[0].weighted_sq == pytest.approx(1.0)
    assert trace.cost_total == pytest.approx(float(np.dot(residual_vector, residual_vector)))


def test_uwb_gnss_fusion_improves_relative_error_but_not_common_bias() -> None:
    from swarmfix.estimation.gnss_only import estimate_gnss_only
    from swarmfix.estimation.uwb_gnss_fusion import estimate_uwb_gnss_fusion
    from swarmfix.evaluation.metrics import absolute_rmse, relative_rmse
    from swarmfix.scenarios.formations import make_square_formation
    from swarmfix.sensors.gnss import simulate_gnss
    from swarmfix.sensors.uwb import simulate_uwb

    scenario = make_square_formation(spacing_m=5.0)
    gnss = simulate_gnss(
        scenario,
        sigma_m=2.0,
        common_bias_m=(2.0, -1.0),
        independent_sigma_m=0.8,
        seed=42,
    )
    uwb = simulate_uwb(scenario, sigma_m=0.01, seed=42)
    gnss_only = estimate_gnss_only(gnss)
    fused, trace = estimate_uwb_gnss_fusion(gnss, uwb)

    assert fused.method == "uwb_gnss_fusion"
    assert trace.iterations
    assert relative_rmse(scenario, fused) < relative_rmse(scenario, gnss_only)

    biased_gnss = simulate_gnss(
        scenario,
        sigma_m=2.0,
        common_bias_m=(2.0, 0.0),
        independent_sigma_m=0.0,
        seed=1,
    )
    biased_uwb = simulate_uwb(scenario, sigma_m=0.01, seed=1)
    biased_fused, _ = estimate_uwb_gnss_fusion(biased_gnss, biased_uwb)
    assert absolute_rmse(scenario, biased_fused) > 1.5


def test_uwb_gnss_fusion_rejects_missing_and_duplicate_gnss_measurements() -> None:
    from swarmfix.estimation.uwb_gnss_fusion import estimate_uwb_gnss_fusion
    from swarmfix.models.measurements import GnssMeasurement, MeasurementSet

    with pytest.raises(ValueError, match="requires GNSS"):
        estimate_uwb_gnss_fusion(MeasurementSet())

    duplicate_measurements = MeasurementSet(
        gnss=[
            GnssMeasurement(agent_id="robot_0", position_m=(0.0, 0.0), sigma_m=1.0),
            GnssMeasurement(agent_id="robot_0", position_m=(1.0, 0.0), sigma_m=1.0),
        ]
    )
    with pytest.raises(ValueError, match="duplicate"):
        estimate_uwb_gnss_fusion(duplicate_measurements)


def test_mission_bias_correction_applies_reference_translation_to_all_agents() -> None:
    from swarmfix.estimation.mission_bias_correction import apply_mission_bias_correction
    from swarmfix.estimation.uwb_gnss_fusion import estimate_uwb_gnss_fusion
    from swarmfix.evaluation.metrics import absolute_rmse
    from swarmfix.models.measurements import MeasurementSet
    from swarmfix.scenarios.formations import make_square_formation
    from swarmfix.sensors.gnss import simulate_gnss
    from swarmfix.sensors.reference import simulate_reference
    from swarmfix.sensors.uwb import simulate_uwb

    scenario = make_square_formation(spacing_m=5.0)
    biased_gnss = simulate_gnss(
        scenario,
        sigma_m=2.0,
        common_bias_m=(2.0, 0.0),
        independent_sigma_m=0.0,
        seed=1,
    )
    biased_uwb = simulate_uwb(scenario, sigma_m=0.01, seed=1)
    biased_fused, _ = estimate_uwb_gnss_fusion(biased_gnss, biased_uwb)
    reference = simulate_reference(
        scenario,
        enabled=True,
        reference_type="known_agent_position",
        agent_id="robot_0",
        position_m=(0.0, 0.0),
    )
    corrected = apply_mission_bias_correction(biased_fused, reference)

    assert absolute_rmse(scenario, corrected) < absolute_rmse(scenario, biased_fused)

    with pytest.raises(ValueError):
        apply_mission_bias_correction(biased_fused, MeasurementSet())
