"""Convert live viewer requests into authoritative Python solver responses."""

from __future__ import annotations

from time import perf_counter
from uuid import uuid4

from swarmfix.estimation.solver_backend import SolverBackend, get_solver_backend
from swarmfix.estimation.gnss_only import estimate_gnss_only
from swarmfix.live.models import (
    LiveConstraintEdge,
    LiveConstraintNode,
    LiveConstraintSection,
    LiveErrorSummary,
    LiveEstimateSection,
    LivePositionEstimate,
    LiveSolveMetadata,
    LiveSolveQualitySummary,
    LiveSolveRequest,
    LiveSolveResponse,
    LiveTraceIteration,
    LiveTraceSection,
)
from swarmfix.models.measurements import (
    GnssMeasurement,
    MeasurementSet,
    UwbRangeMeasurement,
)
from swarmfix.models.residuals import SolverTrace, UwbResidual
from swarmfix.observability.events import ObservationEvent, TraceContext
from swarmfix.observability.sink import NoOpSink, ObservationSink


def _link_key(source_id: str, target_id: str) -> tuple[str, str]:
    """Return a stable key for an undirected UWB link."""
    key = tuple(sorted((source_id, target_id)))
    return key


def _validate_unique_ids(label: str, ids: list[str]) -> None:
    """Reject duplicate identifiers with a domain-specific message."""
    if len(ids) != len(set(ids)):
        raise ValueError(f"duplicate {label}")


def _validate_positions(label: str,
                        positions: dict[str, tuple[float, ...]],
                        dimension: int) -> None:
    """Reject positions whose dimension does not match the live request."""
    for agent_id, position in positions.items():
        if len(position) != dimension:
            raise ValueError(
                f"{label} position for {agent_id} does not match dimension {dimension}"
            )


def _selected_measurements(request: LiveSolveRequest) -> list[UwbRangeMeasurement]:
    """Return UWB measurements selected by the live controls."""
    agent_ids = {agent.agent_id for agent in request.agents}
    available_keys: set[tuple[str, str]] = set()
    selected_keys: set[tuple[str, str]] | None = None

    if request.selected_uwb_links is not None:
        selected_keys = {
            _link_key(link.source_id, link.target_id)
            for link in request.selected_uwb_links
        }

    measurements: list[UwbRangeMeasurement] = []
    for measurement in request.uwb:
        if measurement.source_id not in agent_ids or measurement.target_id not in agent_ids:
            raise ValueError("unknown UWB endpoint")
        link_key = _link_key(measurement.source_id, measurement.target_id)
        if link_key in available_keys:
            raise ValueError("duplicate UWB link")
        available_keys.add(link_key)
        if selected_keys is not None and link_key not in selected_keys:
            continue
        converted_measurement = UwbRangeMeasurement(
            source_id=measurement.source_id,
            target_id=measurement.target_id,
            distance_m=measurement.distance_m,
            sigma_m=measurement.sigma_m,
            true_distance_m=measurement.true_distance_m,
        )
        measurements.append(converted_measurement)

    if selected_keys is not None and selected_keys - available_keys:
        raise ValueError("selected UWB link is not available")

    return measurements


def _build_measurements(request: LiveSolveRequest) -> MeasurementSet:
    """Validate and convert a live request into estimator measurements."""
    agent_ids = [agent.agent_id for agent in request.agents]
    _validate_unique_ids("agent ids", agent_ids)

    truth_positions = {agent.agent_id: agent.position_m for agent in request.agents}
    _validate_positions("agent", truth_positions, request.dimension)

    gnss_ids = [measurement.agent_id for measurement in request.gnss]
    _validate_unique_ids("GNSS measurement agent IDs", gnss_ids)
    if set(gnss_ids) != set(agent_ids):
        raise ValueError("live solve requires a GNSS measurement for each agent")

    gnss_positions = {
        measurement.agent_id: measurement.position_m
        for measurement in request.gnss
    }
    _validate_positions("GNSS", gnss_positions, request.dimension)

    gnss_measurements = [
        GnssMeasurement(
            agent_id=measurement.agent_id,
            position_m=measurement.position_m,
            sigma_m=measurement.sigma_m,
        )
        for measurement in request.gnss
    ]
    selected_uwb_measurements = _selected_measurements(request)
    measurements = MeasurementSet(
        gnss=gnss_measurements,
        uwb=selected_uwb_measurements,
    )
    return measurements


def _latest_uwb_residuals(trace: SolverTrace) -> dict[tuple[str, str], UwbResidual]:
    """Return final UWB residuals keyed by undirected endpoint pair."""
    if not trace.iterations:
        return {}

    latest_iteration = trace.iterations[-1]
    residuals = {
        _link_key(residual.source_id, residual.target_id): residual
        for residual in latest_iteration.uwb_residuals
    }
    return residuals


def _constraint_state(degree: int) -> str:
    """Classify how much UWB information constrains one agent."""
    if degree == 0:
        return "no_uwb"
    if degree == 1:
        return "weak_uwb"
    return "multi_uwb"


def _graph_support_by_agent(request: LiveSolveRequest,
                            measurements: MeasurementSet) -> dict[str, str]:
    """Classify selected UWB graph support without implying UWB direction."""
    graph_support = {agent.agent_id: "none" for agent in request.agents}
    neighbors = {agent.agent_id: set() for agent in request.agents}
    for measurement in measurements.uwb:
        neighbors[measurement.source_id].add(measurement.target_id)
        neighbors[measurement.target_id].add(measurement.source_id)

    visited_agents: set[str] = set()
    for agent_id in neighbors:
        if agent_id in visited_agents:
            continue
        component_agents: set[str] = set()
        pending_agents = [agent_id]
        while pending_agents:
            current_agent = pending_agents.pop()
            if current_agent in visited_agents:
                continue
            visited_agents.add(current_agent)
            component_agents.add(current_agent)
            pending_agents.extend(sorted(neighbors[current_agent] - visited_agents))

        component_edge_count = sum(
            len(neighbors[component_agent])
            for component_agent in component_agents
        ) // 2
        if component_edge_count == 1:
            for component_agent in component_agents:
                if neighbors[component_agent]:
                    graph_support[component_agent] = "weak_range"
        elif component_edge_count >= 2:
            for component_agent in component_agents:
                graph_support[component_agent] = "chain"

    for agent_id, agent_neighbors in neighbors.items():
        neighbor_list = sorted(agent_neighbors)
        for source_index, source_neighbor in enumerate(neighbor_list):
            for target_neighbor in neighbor_list[source_index + 1:]:
                if target_neighbor in neighbors[source_neighbor]:
                    graph_support[agent_id] = "triangle"
                    graph_support[source_neighbor] = "triangle"
                    graph_support[target_neighbor] = "triangle"

    return graph_support


def _root_trace_context(request: LiveSolveRequest) -> TraceContext:
    """Return request trace context or create a root context for this solve."""
    if request.trace_context is not None:
        return request.trace_context

    root_context = TraceContext(
        session_id=f"session-{uuid4().hex}",
        trace_id=f"trace-{uuid4().hex}",
        span_id=f"live-solve-{uuid4().hex[:8]}",
    )
    return root_context


def _emit_event(sink: ObservationSink,
                trace_context: TraceContext,
                event: str,
                fields: dict[str, object] | None = None,
                duration_ms: float | None = None) -> None:
    """Emit one live solver observability event."""
    observation_event = ObservationEvent.from_context(
        trace_context,
        component="python-live-solver",
        event=event,
        duration_ms=duration_ms,
        fields=fields,
    )
    sink.emit(observation_event)


def _build_constraints(request: LiveSolveRequest,
                       measurements: MeasurementSet,
                       trace: SolverTrace) -> LiveConstraintSection:
    """Build viewer-facing UWB constraint metadata."""
    degree_by_agent = {agent.agent_id: 0 for agent in request.agents}
    graph_support = _graph_support_by_agent(request, measurements)
    latest_residuals = _latest_uwb_residuals(trace)
    edges: list[LiveConstraintEdge] = []

    for measurement in measurements.uwb:
        degree_by_agent[measurement.source_id] += 1
        degree_by_agent[measurement.target_id] += 1
        residual = latest_residuals.get(_link_key(measurement.source_id, measurement.target_id))
        residual_m = residual.residual_m if residual is not None else None
        weighted_sq = residual.weighted_sq if residual is not None else None
        edge = LiveConstraintEdge(
            source_id=measurement.source_id,
            target_id=measurement.target_id,
            measured_distance_m=measurement.distance_m,
            sigma_m=measurement.sigma_m,
            residual_m=residual_m,
            weighted_sq=weighted_sq,
        )
        edges.append(edge)

    nodes = [
        LiveConstraintNode(
            agent_id=agent_id,
            selected_uwb_degree=degree,
            constraint_state=_constraint_state(degree),
            graph_support=graph_support[agent_id],
        )
        for agent_id, degree in degree_by_agent.items()
    ]
    constraints = LiveConstraintSection(nodes=nodes, edges=edges)
    return constraints


def _position_estimates(estimates: list) -> list[LivePositionEstimate]:
    """Convert estimator position records into live response records."""
    live_estimates = [
        LivePositionEstimate(
            agent_id=estimate.agent_id,
            position_m=estimate.position_m,
        )
        for estimate in estimates
    ]
    return live_estimates


def _distance_between(first_position: tuple[float, ...],
                      second_position: tuple[float, ...]) -> float:
    """Return Euclidean distance between positions, padding short vectors."""
    dimension = max(len(first_position), len(second_position))
    squared_distance = 0.0
    for index in range(dimension):
        delta = (
            (first_position[index] if index < len(first_position) else 0.0)
            - (second_position[index] if index < len(second_position) else 0.0)
        )
        squared_distance += delta * delta

    distance_m = squared_distance ** 0.5
    return distance_m


def _error_summary(truth_positions: dict[str, tuple[float, ...]],
                   comparison_positions: dict[str, tuple[float, ...]]) -> LiveErrorSummary | None:
    """Summarize position error for matched agents."""
    errors = []
    for agent_id, truth_position in truth_positions.items():
        comparison_position = comparison_positions.get(agent_id)
        if comparison_position is None:
            continue
        errors.append(_distance_between(truth_position, comparison_position))

    if not errors:
        return None

    squared_error_sum = sum(error_m ** 2 for error_m in errors)
    error_sum = sum(errors)
    summary = LiveErrorSummary(
        rmse_m=(squared_error_sum / len(errors)) ** 0.5,
        mean_error_m=error_sum / len(errors),
        max_error_m=max(errors),
    )
    return summary


def _quality_summary(request: LiveSolveRequest,
                     estimates: LiveEstimateSection,
                     trace: SolverTrace) -> LiveSolveQualitySummary:
    """Build compact solve-quality metrics for the exact request snapshot."""
    truth_positions = {
        agent.agent_id: agent.position_m
        for agent in request.agents
    }
    fused_positions = {
        estimate.agent_id: estimate.position_m
        for estimate in estimates.fused
    }
    gnss_positions = {
        measurement.agent_id: measurement.position_m
        for measurement in request.gnss
    }
    solve_error = _error_summary(truth_positions, fused_positions)
    gnss_truth_error = _error_summary(truth_positions, gnss_positions)
    if solve_error is None or gnss_truth_error is None:
        raise ValueError("live solve quality requires matched truth, fused, and GNSS positions")

    solve_improvement_rmse_m = gnss_truth_error.rmse_m - solve_error.rmse_m
    solve_error_ratio_to_gnss = (
        solve_error.rmse_m / gnss_truth_error.rmse_m
        if gnss_truth_error.rmse_m > 0.0
        else None
    )
    final_iteration = trace.iterations[-1] if trace.iterations else None
    quality = LiveSolveQualitySummary(
        solve_error=solve_error,
        gnss_truth_error=gnss_truth_error,
        solve_improvement_rmse_m=solve_improvement_rmse_m,
        solve_error_ratio_to_gnss=solve_error_ratio_to_gnss,
        fused_worse_than_gnss=solve_error.rmse_m > gnss_truth_error.rmse_m,
        final_cost_total=final_iteration.cost_total if final_iteration else None,
        final_cost_gnss=final_iteration.cost_gnss if final_iteration else None,
        final_cost_uwb=final_iteration.cost_uwb if final_iteration else None,
    )
    return quality


def _quality_event_fields(quality: LiveSolveQualitySummary) -> dict[str, object]:
    """Flatten solve-quality metrics for trace event fields."""
    fields = {
        "solve_error_rmse_m": quality.solve_error.rmse_m,
        "solve_error_mean_m": quality.solve_error.mean_error_m,
        "solve_error_max_m": quality.solve_error.max_error_m,
        "gnss_truth_error_rmse_m": quality.gnss_truth_error.rmse_m,
        "gnss_truth_error_mean_m": quality.gnss_truth_error.mean_error_m,
        "gnss_truth_error_max_m": quality.gnss_truth_error.max_error_m,
        "solve_improvement_rmse_m": quality.solve_improvement_rmse_m,
        "solve_error_ratio_to_gnss": quality.solve_error_ratio_to_gnss,
        "fused_worse_than_gnss": quality.fused_worse_than_gnss,
        "final_cost_total": quality.final_cost_total,
        "final_cost_gnss": quality.final_cost_gnss,
        "final_cost_uwb": quality.final_cost_uwb,
    }
    return fields


def _trace_section(trace: SolverTrace) -> LiveTraceSection:
    """Convert solver trace records into serializable live trace models."""
    iterations = []
    for iteration in trace.iterations:
        trace_iteration = LiveTraceIteration(
            iteration=iteration.iteration,
            positions=iteration.positions,
            cost_total=iteration.cost_total,
            cost_gnss=iteration.cost_gnss,
            cost_uwb=iteration.cost_uwb,
            gnss_residuals=[
                residual.model_dump()
                for residual in iteration.gnss_residuals
            ],
            uwb_residuals=[
                residual.model_dump()
                for residual in iteration.uwb_residuals
            ],
        )
        iterations.append(trace_iteration)
    live_trace = LiveTraceSection(trace_type=trace.trace_type, iterations=iterations)
    return live_trace


def solve_live_request(request: LiveSolveRequest,
                       observability_sink: ObservationSink | None = None,
                       solver_backend: SolverBackend | None = None) -> LiveSolveResponse:
    """Run an authoritative live GNSS/UWB solve for a viewer request."""
    sink = observability_sink or NoOpSink()
    backend = solver_backend or get_solver_backend()
    solver_backend_name = backend.name
    trace_context = _root_trace_context(request)
    started_seconds = perf_counter()
    _emit_event(
        sink,
        trace_context,
        "live_solve_request_started",
        fields={
            "solver_backend": solver_backend_name,
            "agent_count": len(request.agents),
            "selected_uwb_links": (
                len(request.selected_uwb_links)
                if request.selected_uwb_links is not None
                else None
            ),
        },
    )

    try:
        measurements = _build_measurements(request)
        _emit_event(
            sink,
            trace_context,
            "live_solve_measurements_validated",
            fields={
                "solver_backend": solver_backend_name,
                "gnss_count": len(measurements.gnss),
                "uwb_count": len(measurements.uwb),
            },
        )
        graph_support = _graph_support_by_agent(request, measurements)
        _emit_event(
            sink,
            trace_context,
            "live_solve_selected_graph_built",
            fields={
                "solver_backend": solver_backend_name,
                "selected_uwb_count": len(measurements.uwb),
                "graph_support": graph_support,
            },
        )
        fused_estimates, solver_trace = backend.solve(
            measurements,
            max_iterations=request.estimation.max_iterations,
            robust_loss=request.estimation.robust_loss,
        )
        gnss_only_estimates = estimate_gnss_only(measurements)
        estimates = LiveEstimateSection(
            fused=_position_estimates(fused_estimates.estimates),
            gnss_only=_position_estimates(gnss_only_estimates.estimates),
        )
        quality = _quality_summary(request, estimates, solver_trace)
        constraints = _build_constraints(request, measurements, solver_trace)
        duration_ms = (perf_counter() - started_seconds) * 1000.0
        _emit_event(
            sink,
            trace_context,
            "live_solve_completed",
            fields={
                "solver_backend": solver_backend_name,
                "trace_iterations": len(solver_trace.iterations),
                "selected_uwb_count": len(measurements.uwb),
                "agent_count": len(request.agents),
                "robust_loss": request.estimation.robust_loss,
                "max_iterations": request.estimation.max_iterations,
                **_quality_event_fields(quality),
            },
            duration_ms=duration_ms,
        )
        live_response = LiveSolveResponse(
            schema_version=request.schema_version,
            metadata=LiveSolveMetadata(
                solver=solver_backend_name,
                selected_uwb_count=len(measurements.uwb),
                trace_context=trace_context.model_dump(mode="json"),
                quality=quality,
            ),
            truth=request.agents,
            measurements={
                "gnss": [measurement.model_dump() for measurement in request.gnss],
                "uwb": [measurement.model_dump() for measurement in request.uwb],
            },
            estimates=estimates,
            trace=_trace_section(solver_trace),
            constraints=constraints,
        )
        return live_response
    except Exception as error:
        _emit_event(
            sink,
            trace_context,
            "live_solve_failed",
            fields={
                "solver_backend": solver_backend_name,
                "error_type": type(error).__name__,
                "error": str(error),
            },
            duration_ms=(perf_counter() - started_seconds) * 1000.0,
        )
        raise
