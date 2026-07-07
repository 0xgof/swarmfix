"""Tests for SwarmFix workflow orchestration."""


def write_square_config(config_path, reference_enabled: bool = True) -> None:
    """Write a workflow config."""
    config_path.write_text(
        f"""
seed = 5

[scenario]
name = "square_static"
dimension = 2
formation = "square"
num_agents = 4
spacing_m = 5.0

[gnss]
sigma_m = 2.0
common_bias_m = [0.0, 0.0]
independent_sigma_m = 0.0

[uwb]
enabled = true
sigma_m = 0.1

[reference]
enabled = {str(reference_enabled).lower()}
type = "known_agent_position"
agent_id = "robot_0"
position_m = [0.0, 0.0]

[estimation]
method = "least_squares"
robust_loss = "linear"
export_solver_trace = true
max_iterations = 10
""",
        encoding="utf-8",
    )


def test_run_pipeline_returns_complete_typed_result(tmp_path) -> None:
    from swarmfix.models.results import PipelineResult
    from swarmfix.workflow.run_pipeline import run_pipeline

    config_path = tmp_path / "square.toml"
    write_square_config(config_path)

    result = run_pipeline(config_path)

    assert isinstance(result, PipelineResult)
    assert result.scenario.name == "square_static"
    assert "gnss_only" in result.estimates
    assert "fused" in result.estimates
    assert "corrected" in result.estimates
    assert result.solver_trace is not None


def test_run_pipeline_does_not_write_outputs_unless_export_is_called(tmp_path) -> None:
    from swarmfix.workflow.run_pipeline import run_pipeline

    config_path = tmp_path / "square.toml"
    write_square_config(config_path, reference_enabled=False)

    run_pipeline(config_path)

    assert sorted(path.name for path in tmp_path.iterdir()) == ["square.toml"]


def test_run_pipeline_without_reference_does_not_create_corrected_estimate(tmp_path) -> None:
    from swarmfix.workflow.run_pipeline import run_pipeline

    config_path = tmp_path / "square.toml"
    write_square_config(config_path, reference_enabled=False)

    result = run_pipeline(config_path)

    assert "gnss_only" in result.estimates
    assert "fused" in result.estimates
    assert "corrected" not in result.estimates
