"""Tests for GNSS, UWB, and reference sensor simulators."""

import pytest


def test_gnss_common_bias_and_seeded_noise_are_deterministic() -> None:
    from swarmfix.scenarios.formations import make_square_formation
    from swarmfix.sensors.gnss import simulate_gnss

    scenario = make_square_formation(spacing_m=5.0)
    gnss = simulate_gnss(
        scenario,
        sigma_m=2.0,
        common_bias_m=(1.0, -2.0),
        independent_sigma_m=0.0,
        seed=7,
    )

    for measurement in gnss.gnss:
        truth = scenario.agent_position(measurement.agent_id)
        assert measurement.position_m == pytest.approx((truth[0] + 1.0, truth[1] - 2.0))
        assert measurement.sigma_m == 2.0

    repeated = simulate_gnss(
        scenario,
        sigma_m=2.0,
        common_bias_m=(1.0, -2.0),
        independent_sigma_m=0.4,
        seed=7,
    )
    repeated_again = simulate_gnss(
        scenario,
        sigma_m=2.0,
        common_bias_m=(1.0, -2.0),
        independent_sigma_m=0.4,
        seed=7,
    )
    assert repeated.gnss == repeated_again.gnss


def test_gnss_rejects_invalid_uncertainty_and_bias_dimensions() -> None:
    from swarmfix.scenarios.formations import make_square_formation
    from swarmfix.sensors.gnss import simulate_gnss

    scenario = make_square_formation(spacing_m=5.0)

    with pytest.raises(ValueError):
        simulate_gnss(scenario, sigma_m=0.0, common_bias_m=(0.0, 0.0), independent_sigma_m=0.0)

    with pytest.raises(ValueError):
        simulate_gnss(scenario, sigma_m=1.0, common_bias_m=(0.0,), independent_sigma_m=0.0)

    with pytest.raises(ValueError):
        simulate_gnss(scenario, sigma_m=1.0, common_bias_m=(0.0, 0.0), independent_sigma_m=-0.1)


def test_gnss_outlier_noise_is_seeded_and_disabled_by_default() -> None:
    from swarmfix.scenarios.formations import make_square_formation
    from swarmfix.sensors.gnss import simulate_gnss

    scenario = make_square_formation(spacing_m=5.0)
    baseline = simulate_gnss(
        scenario,
        sigma_m=2.0,
        common_bias_m=(0.0, 0.0),
        independent_sigma_m=0.0,
        seed=9,
    )
    outlier_run = simulate_gnss(
        scenario,
        sigma_m=2.0,
        common_bias_m=(0.0, 0.0),
        independent_sigma_m=0.0,
        seed=9,
        outlier_probability=1.0,
        outlier_sigma_m=8.0,
    )
    repeated_outlier_run = simulate_gnss(
        scenario,
        sigma_m=2.0,
        common_bias_m=(0.0, 0.0),
        independent_sigma_m=0.0,
        seed=9,
        outlier_probability=1.0,
        outlier_sigma_m=8.0,
    )

    assert baseline.gnss != outlier_run.gnss
    assert outlier_run.gnss == repeated_outlier_run.gnss


def test_gnss_spatial_correlation_is_seeded_and_separate_from_common_bias() -> None:
    from swarmfix.scenarios.formations import make_grid_formation
    from swarmfix.sensors.gnss import simulate_gnss

    scenario = make_grid_formation(num_agents=4, spacing_m=5.0)
    correlated = simulate_gnss(
        scenario,
        sigma_m=2.0,
        common_bias_m=(1.0, -0.5),
        independent_sigma_m=0.0,
        seed=3,
        spatial_correlation_enabled=True,
        spatial_correlation_length_m=20.0,
        spatial_correlation_sigma_m=0.8,
    )
    repeated = simulate_gnss(
        scenario,
        sigma_m=2.0,
        common_bias_m=(1.0, -0.5),
        independent_sigma_m=0.0,
        seed=3,
        spatial_correlation_enabled=True,
        spatial_correlation_length_m=20.0,
        spatial_correlation_sigma_m=0.8,
    )
    disabled = simulate_gnss(
        scenario,
        sigma_m=2.0,
        common_bias_m=(1.0, -0.5),
        independent_sigma_m=0.0,
        seed=3,
        spatial_correlation_enabled=False,
        spatial_correlation_length_m=20.0,
        spatial_correlation_sigma_m=0.8,
    )

    assert correlated.gnss == repeated.gnss
    assert correlated.gnss != disabled.gnss
    for measurement in disabled.gnss:
        truth = scenario.agent_position(measurement.agent_id)
        assert measurement.position_m == pytest.approx((truth[0] + 1.0, truth[1] - 0.5))


def test_gnss_rejects_invalid_outlier_and_spatial_correlation_settings() -> None:
    from swarmfix.scenarios.formations import make_square_formation
    from swarmfix.sensors.gnss import simulate_gnss

    scenario = make_square_formation(spacing_m=5.0)

    with pytest.raises(ValueError, match="outlier_probability"):
        simulate_gnss(
            scenario,
            sigma_m=1.0,
            common_bias_m=(0.0, 0.0),
            independent_sigma_m=0.0,
            outlier_probability=1.2,
        )

    with pytest.raises(ValueError, match="outlier_sigma_m"):
        simulate_gnss(
            scenario,
            sigma_m=1.0,
            common_bias_m=(0.0, 0.0),
            independent_sigma_m=0.0,
            outlier_probability=0.5,
            outlier_sigma_m=-1.0,
        )

    with pytest.raises(ValueError, match="spatial_correlation_length_m"):
        simulate_gnss(
            scenario,
            sigma_m=1.0,
            common_bias_m=(0.0, 0.0),
            independent_sigma_m=0.0,
            spatial_correlation_enabled=True,
            spatial_correlation_length_m=0.0,
            spatial_correlation_sigma_m=1.0,
        )


def test_uwb_uses_topology_or_full_pairwise_fallback() -> None:
    from swarmfix.scenarios.formations import make_square_formation
    from swarmfix.scenarios.topologies import build_neighbour_topology
    from swarmfix.sensors.uwb import simulate_uwb

    scenario = make_square_formation(spacing_m=5.0)
    fallback_uwb = simulate_uwb(scenario, sigma_m=0.1, seed=7)
    assert len(fallback_uwb.uwb) == 6

    scenario_with_topology = scenario.model_copy(
        update={"topology": build_neighbour_topology(scenario, max_distance_m=5.1)}
    )
    topology_uwb = simulate_uwb(scenario_with_topology, sigma_m=0.1, seed=7)
    assert len(topology_uwb.uwb) == 4

    with pytest.raises(ValueError):
        simulate_uwb(scenario, sigma_m=0.0)


def test_uwb_missing_links_are_seeded_and_disabled_by_default() -> None:
    from swarmfix.scenarios.formations import make_square_formation
    from swarmfix.sensors.uwb import simulate_uwb

    scenario = make_square_formation(spacing_m=5.0)
    baseline = simulate_uwb(
        scenario,
        sigma_m=0.1,
        seed=4,
        missing_link_probability=0.0,
    )
    missing = simulate_uwb(
        scenario,
        sigma_m=0.1,
        seed=4,
        missing_link_probability=0.5,
    )
    repeated_missing = simulate_uwb(
        scenario,
        sigma_m=0.1,
        seed=4,
        missing_link_probability=0.5,
    )

    assert len(baseline.uwb) == 6
    assert len(missing.uwb) < len(baseline.uwb)
    assert missing.uwb == repeated_missing.uwb


def test_uwb_nlos_bias_makes_selected_ranges_longer() -> None:
    from swarmfix.scenarios.formations import make_square_formation
    from swarmfix.sensors.uwb import simulate_uwb

    scenario = make_square_formation(spacing_m=5.0)
    unbiased = simulate_uwb(
        scenario,
        sigma_m=0.1,
        seed=12,
        nlos_probability=0.0,
        nlos_positive_bias_m=2.0,
    )
    biased = simulate_uwb(
        scenario,
        sigma_m=0.1,
        seed=12,
        nlos_probability=1.0,
        nlos_positive_bias_m=2.0,
    )

    for unbiased_measurement, biased_measurement in zip(unbiased.uwb, biased.uwb):
        assert biased_measurement.distance_m == pytest.approx(
            unbiased_measurement.distance_m + 2.0
        )


def test_uwb_rejects_invalid_missing_link_and_nlos_settings() -> None:
    from swarmfix.scenarios.formations import make_square_formation
    from swarmfix.sensors.uwb import simulate_uwb

    scenario = make_square_formation(spacing_m=5.0)

    with pytest.raises(ValueError, match="missing_link_probability"):
        simulate_uwb(scenario, sigma_m=0.1, missing_link_probability=-0.1)

    with pytest.raises(ValueError, match="nlos_probability"):
        simulate_uwb(scenario, sigma_m=0.1, nlos_probability=1.1)

    with pytest.raises(ValueError, match="nlos_positive_bias_m"):
        simulate_uwb(
            scenario,
            sigma_m=0.1,
            nlos_probability=0.5,
            nlos_positive_bias_m=-1.0,
        )


def test_reference_simulator_handles_enabled_disabled_and_invalid_references() -> None:
    from swarmfix.scenarios.formations import make_square_formation
    from swarmfix.sensors.reference import simulate_reference

    scenario = make_square_formation(spacing_m=5.0)
    reference = simulate_reference(
        scenario,
        enabled=True,
        reference_type="known_agent_position",
        agent_id="robot_0",
        position_m=(0.0, 0.0),
    )
    disabled_reference = simulate_reference(
        scenario,
        enabled=False,
        reference_type="known_agent_position",
        agent_id=None,
        position_m=None,
    )

    assert reference.references[0].agent_id == "robot_0"
    assert disabled_reference.references == []

    with pytest.raises(KeyError):
        simulate_reference(
            scenario,
            enabled=True,
            reference_type="known_agent_position",
            agent_id="missing",
            position_m=(0.0, 0.0),
        )

    with pytest.raises(ValueError, match="unsupported reference"):
        simulate_reference(
            scenario,
            enabled=True,
            reference_type="landmark",
            agent_id="robot_0",
            position_m=(0.0, 0.0),
        )

    with pytest.raises(ValueError, match="required"):
        simulate_reference(
            scenario,
            enabled=True,
            reference_type="known_agent_position",
            agent_id=None,
            position_m=(0.0, 0.0),
        )

    with pytest.raises(ValueError, match="dimension"):
        simulate_reference(
            scenario,
            enabled=True,
            reference_type="known_agent_position",
            agent_id="robot_0",
            position_m=(0.0,),
        )
