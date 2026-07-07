"""Tests for SwarmFix configuration and JSON export modules."""

import json

import pytest
from pydantic import ValidationError


def write_square_config(config_path) -> None:
    """Write a valid static square config for IO and workflow tests."""
    config_path.write_text(
        """
seed = 5

[scenario]
name = "square_static"
dimension = 2
formation = "square"
num_agents = 4
spacing_m = 5.0

[topology]
mode = "full_pairwise"

[gnss]
sigma_m = 2.0
common_bias_m = [1.0, -0.5]
independent_sigma_m = 0.3

[uwb]
enabled = true
sigma_m = 0.1
max_range_m = 20.0

[reference]
enabled = true
type = "known_agent_position"
agent_id = "robot_0"
position_m = [0.0, 0.0]

[estimation]
method = "least_squares"
robust_loss = "linear"
export_solver_trace = true
max_iterations = 30
""",
        encoding="utf-8",
    )


def test_load_config_validates_toml_into_typed_config(tmp_path) -> None:
    from swarmfix.io.config import load_config

    config_path = tmp_path / "square.toml"
    write_square_config(config_path)

    config = load_config(config_path)

    assert config.scenario.formation == "square"
    assert config.gnss.common_bias_m == (1.0, -0.5)
    assert config.estimation.max_iterations == 30


def test_load_config_rejects_bad_toml_before_workflow(tmp_path) -> None:
    from swarmfix.io.config import load_config

    config_path = tmp_path / "bad.toml"
    config_path.write_text(
        """
seed = 1

[scenario]
name = "bad"
dimension = 2
formation = "square"
num_agents = 4
spacing_m = 5.0

[gnss]
sigma_m = -1.0
common_bias_m = [1.0]
independent_sigma_m = 0.0

[uwb]
enabled = true
sigma_m = 0.1
""",
        encoding="utf-8",
    )

    with pytest.raises(ValidationError):
        load_config(config_path)


@pytest.mark.parametrize(
    ("override", "expected_message"),
    [
        ("dimension = 3", "dimension"),
        ("num_agents = 0", "num_agents"),
        ("spacing_m = 0.0", "spacing_m"),
    ],
)
def test_scenario_config_rejects_invalid_scenario_fields(override,
                                                         expected_message) -> None:
    from pydantic import ValidationError

    from swarmfix.io.config import ScenarioConfig

    data = {
        "name": "bad",
        "dimension": 2,
        "formation": "square",
        "num_agents": 4,
        "spacing_m": 5.0,
    }
    key, raw_value = [part.strip() for part in override.split("=")]
    data[key] = int(raw_value) if raw_value.isdigit() else float(raw_value)

    with pytest.raises(ValidationError, match=expected_message):
        ScenarioConfig.model_validate(data)


def test_topology_and_estimation_configs_reject_invalid_values() -> None:
    from swarmfix.io.config import EstimationConfig, TopologyConfig

    with pytest.raises(ValidationError, match="max_distance"):
        TopologyConfig(mode="neighbour", max_distance_m=0.0)

    with pytest.raises(ValidationError, match="method"):
        EstimationConfig(method="particle_filter")

    with pytest.raises(ValidationError, match="robust_loss"):
        EstimationConfig(robust_loss="unsupported")


def test_sensor_config_classes_reject_invalid_uncertainty_values() -> None:
    from swarmfix.io.config import GnssConfig, UwbConfig

    with pytest.raises(ValidationError, match="sigma"):
        GnssConfig(sigma_m=0.0, common_bias_m=(0.0, 0.0), independent_sigma_m=0.0)

    with pytest.raises(ValidationError, match="independent"):
        GnssConfig(sigma_m=1.0, common_bias_m=(0.0, 0.0), independent_sigma_m=-0.1)

    with pytest.raises(ValidationError, match="outlier_probability"):
        GnssConfig(
            sigma_m=1.0,
            common_bias_m=(0.0, 0.0),
            independent_sigma_m=0.0,
            outlier_probability=-0.1,
        )

    with pytest.raises(ValidationError, match="outlier_sigma"):
        GnssConfig(
            sigma_m=1.0,
            common_bias_m=(0.0, 0.0),
            independent_sigma_m=0.0,
            outlier_probability=0.5,
            outlier_sigma_m=0.0,
        )

    with pytest.raises(ValidationError, match="spatial_correlation_length"):
        GnssConfig(
            sigma_m=1.0,
            common_bias_m=(0.0, 0.0),
            independent_sigma_m=0.0,
            spatial_correlation_enabled=True,
            spatial_correlation_length_m=0.0,
            spatial_correlation_sigma_m=1.0,
        )

    with pytest.raises(ValidationError, match="sigma"):
        UwbConfig(enabled=True, sigma_m=0.0)

    with pytest.raises(ValidationError, match="max_range"):
        UwbConfig(enabled=True, sigma_m=0.1, max_range_m=0.0)

    with pytest.raises(ValidationError, match="missing_link_probability"):
        UwbConfig(enabled=True, sigma_m=0.1, missing_link_probability=1.2)

    with pytest.raises(ValidationError, match="nlos_probability"):
        UwbConfig(enabled=True, sigma_m=0.1, nlos_probability=-0.1)

    with pytest.raises(ValidationError, match="nlos_positive_bias"):
        UwbConfig(
            enabled=True,
            sigma_m=0.1,
            nlos_probability=0.5,
            nlos_positive_bias_m=-1.0,
        )


def test_swarmfix_config_rejects_cross_section_vector_mismatches() -> None:
    from swarmfix.io.config import SwarmFixConfig

    base_config = {
        "scenario": {
            "name": "square",
            "dimension": 2,
            "formation": "square",
            "num_agents": 4,
            "spacing_m": 5.0,
        },
        "gnss": {
            "sigma_m": 2.0,
            "common_bias_m": [0.0],
            "independent_sigma_m": 0.0,
        },
        "uwb": {
            "enabled": True,
            "sigma_m": 0.1,
        },
    }

    with pytest.raises(ValidationError, match="common_bias"):
        SwarmFixConfig.model_validate(base_config)

    base_config["gnss"]["common_bias_m"] = [0.0, 0.0]
    base_config["reference"] = {
        "enabled": True,
        "type": "known_agent_position",
        "agent_id": "robot_0",
        "position_m": [0.0],
    }
    with pytest.raises(ValidationError, match="reference"):
        SwarmFixConfig.model_validate(base_config)


def test_export_scene_and_trace_json_are_viewer_safe(tmp_path) -> None:
    from swarmfix.io.export_scene import export_scene_json, export_solver_trace_json
    from swarmfix.workflow.run_pipeline import run_pipeline

    config_path = tmp_path / "square.toml"
    scene_path = tmp_path / "scene.json"
    trace_path = tmp_path / "trace.json"
    write_square_config(config_path)
    result = run_pipeline(config_path)

    export_scene_json(result, scene_path)
    export_solver_trace_json(result, trace_path)

    scene_data = json.loads(scene_path.read_text(encoding="utf-8"))
    trace_data = json.loads(trace_path.read_text(encoding="utf-8"))
    assert scene_data["schema_version"] == "0.1.0"
    assert scene_data["truth"]["nodes"][0]["id"] == "robot_0"
    assert scene_data["measurements"]["gnss"][0]["agent_id"] == "robot_0"
    assert scene_data["measurements"]["gnss"][0]["uncertainty"]["type"] == "circle"
    assert scene_data["measurements"]["uwb"][0]["measured_distance_m"] > 0.0
    assert "gnss_only" in scene_data["estimates"]
    assert trace_data["trace"]["iterations"]
    first_iteration = trace_data["trace"]["iterations"][0]
    assert set(first_iteration) == {"iteration", "positions", "cost", "residuals"}
    assert {"total", "gnss", "uwb", "reference"} <= set(first_iteration["cost"])
    assert {"gnss", "uwb", "reference"} <= set(first_iteration["residuals"])


def test_scene_and_trace_dicts_expose_viewer_contract_without_file_writes(tmp_path) -> None:
    from swarmfix.io.export_scene import scene_dict, trace_dict
    from swarmfix.workflow.run_pipeline import run_pipeline

    config_path = tmp_path / "square.toml"
    write_square_config(config_path)
    result = run_pipeline(config_path)

    scene_data = scene_dict(result)
    trace_data = trace_dict(result)

    assert scene_data["metadata"]["dimension"] == 2
    assert scene_data["truth"]["nodes"]
    assert scene_data["measurements"]["references"][0]["agent_id"] == "robot_0"
    assert "trace" not in scene_data
    assert trace_data["trace"]["trace_type"] == "residual_evaluation"


def test_trace_export_handles_missing_solver_trace(tmp_path) -> None:
    from swarmfix.io.export_scene import export_solver_trace_json
    from swarmfix.models.measurements import MeasurementSet
    from swarmfix.models.results import PipelineResult
    from swarmfix.scenarios.formations import make_square_formation

    result = PipelineResult(
        scenario=make_square_formation(spacing_m=5.0),
        measurements=MeasurementSet(),
        estimates={},
        metrics={},
        solver_trace=None,
    )
    output_path = tmp_path / "nested" / "trace.json"

    export_solver_trace_json(result, output_path)

    output_data = json.loads(output_path.read_text(encoding="utf-8"))
    assert output_data["trace"] == {"trace_type": "none", "iterations": []}


def test_write_pipeline_result_persists_scene_json(tmp_path) -> None:
    from swarmfix.io.results import write_pipeline_result
    from swarmfix.workflow.run_pipeline import run_pipeline

    config_path = tmp_path / "square.toml"
    output_path = tmp_path / "result.json"
    write_square_config(config_path)
    result = run_pipeline(config_path)

    write_pipeline_result(result, output_path)

    output_data = json.loads(output_path.read_text(encoding="utf-8"))
    assert output_data["metadata"]["scenario"] == "square_static"
    assert "truth" in output_data
    assert "measurements" in output_data
