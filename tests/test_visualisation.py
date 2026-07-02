"""Tests for Python-side visualisation modules."""

import matplotlib
import pytest
from matplotlib.collections import LineCollection

matplotlib.use("Agg")


def build_result(tmp_path):
    """Build a pipeline result for plotting tests."""
    from swarmfix.workflow.run_pipeline import run_pipeline

    config_path = tmp_path / "square.toml"
    config_path.write_text(
        """
seed = 5

[scenario]
name = "square_static"
dimension = 2
formation = "square"
num_agents = 4
spacing_m = 5.0

[gnss]
sigma_m = 2.0
common_bias_m = [1.0, -0.5]
independent_sigma_m = 0.3

[uwb]
enabled = true
sigma_m = 0.1

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
    result = run_pipeline(config_path)
    return result


def test_plot_scenario_writes_static_scenario_image(tmp_path) -> None:
    from swarmfix.visualisation.plot_scenario import plot_scenario

    result = build_result(tmp_path)
    output_path = tmp_path / "scenario.png"

    figure = plot_scenario(result.scenario, output_path=output_path)
    figure_without_output = plot_scenario(result.scenario)

    assert output_path.exists()
    assert figure.axes
    assert figure_without_output.axes


def test_plot_estimates_writes_overlay_image(tmp_path) -> None:
    from swarmfix.visualisation.plot_estimates import plot_estimates, plot_estimates_with_uwb_links

    result = build_result(tmp_path)
    output_path = tmp_path / "estimates.png"
    uwb_output_path = tmp_path / "estimates_uwb.png"

    figure = plot_estimates(result, output_path=output_path)
    uwb_figure = plot_estimates_with_uwb_links(result, output_path=uwb_output_path)

    assert output_path.exists()
    assert uwb_output_path.exists()
    assert figure.axes
    assert len(figure.axes[0].collections) >= 3
    assert len(figure.axes[0].patches) == len(result.measurements.gnss)
    assert figure.legends
    assert "truth x" in [text.get_text() for text in figure.legends[0].get_texts()]
    assert "GNSS σ" in [
        text.get_text()
        for text in figure.legends[0].get_texts()
    ]
    assert figure.legends[0]._ncols >= 4
    assert len(uwb_figure.axes[0].patches) == len(result.measurements.gnss)
    line_collections = [
        collection
        for collection in uwb_figure.axes[0].collections
        if isinstance(collection, LineCollection)
    ]
    assert len(line_collections) == 2
    assert max(line_collections[0].get_linewidths()) >= 6.0
    assert uwb_figure.legends
    assert "UWB" in [
        text.get_text()
        for text in uwb_figure.legends[0].get_texts()
    ]
    assert uwb_figure.legends[0]._ncols >= 4


def test_plot_error_vectors_rejects_missing_estimate_and_writes_image(tmp_path) -> None:
    from swarmfix.visualisation.plot_errors import plot_error_vectors

    result = build_result(tmp_path)
    output_path = tmp_path / "errors.png"

    figure = plot_error_vectors(result, output_path=output_path)

    assert output_path.exists()
    assert figure.axes
    assert figure.axes[0].patches

    with pytest.raises(ValueError):
        plot_error_vectors(result, estimate_name="missing")


def test_plot_cost_trace_handles_real_and_missing_trace(tmp_path) -> None:
    from swarmfix.visualisation.plot_cost_trace import plot_cost_trace

    result = build_result(tmp_path)
    output_path = tmp_path / "costs.png"

    figure = plot_cost_trace(result.solver_trace, output_path=output_path)
    empty_figure = plot_cost_trace(None)
    empty_trace_figure = plot_cost_trace(result.solver_trace.model_copy(update={"iterations": []}))

    assert output_path.exists()
    assert figure.axes
    assert empty_figure.axes
    assert len(figure.axes[0].lines) == 4
    assert len(empty_figure.axes[0].lines) == 0
    assert len(empty_trace_figure.axes[0].lines) == 0
