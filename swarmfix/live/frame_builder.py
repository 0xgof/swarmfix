"""Backend live-frame orchestration: snapshot, selection, solve, response.

Workflow position: this is the orchestration boundary behind
``POST /live/frame``. It chains the pure live modules --
``sensor_snapshot`` (truth/GNSS/UWB candidates) and ``uwb_selection``
(distance-constraint selection) -- into the existing measurement-level
solve (``solve_live_request``), and assembles the render-ready
``LiveFrameResponse`` the viewer consumes.

Observability is emitted here, at the boundary, with distinct events for
frame start, snapshot built, UWB selection, completion, and failure. Solve
events keep coming from ``solve_live_request`` under a child span, so
frame-building failures are distinguishable from solver failures in logs.
"""

from __future__ import annotations

from time import perf_counter
from uuid import uuid4

from swarmfix.estimation.solver_backend import SolverBackend
from swarmfix.live.models import (
    LiveEstimationOptions,
    LiveFrameMeasurementSection,
    LiveFrameMetadata,
    LiveFrameRequest,
    LiveFrameResponse,
    LiveSolveRequest,
    SelectedUwbLink,
)
from swarmfix.live.sensor_snapshot import LiveSensorSnapshot, build_sensor_snapshot
from swarmfix.live.solve_request import solve_live_request
from swarmfix.live.uwb_selection import (
    LiveUwbSelection,
    LiveUwbSelectionOptions,
    select_live_uwb_links,
    stable_uwb_endpoint_key,
)
from swarmfix.observability.events import ObservationEvent, TraceContext
from swarmfix.observability.sink import NoOpSink, ObservationSink

UNBOUNDED_RANGE_M = float("inf")


def _root_frame_trace_context(request: LiveFrameRequest) -> TraceContext:
    """Return request trace context or create a root context for this frame."""
    if request.trace_context is not None:
        return request.trace_context

    root_context = TraceContext(
        session_id=f"session-{uuid4().hex}",
        trace_id=f"trace-{uuid4().hex}",
        span_id=f"live-frame-{uuid4().hex[:8]}",
    )
    return root_context


def _emit_event(sink: ObservationSink,
                trace_context: TraceContext,
                event: str,
                fields: dict[str, object] | None = None,
                duration_ms: float | None = None) -> None:
    """Emit one live-frame observability event."""
    observation_event = ObservationEvent.from_context(
        trace_context,
        component="python-live-frame",
        event=event,
        duration_ms=duration_ms,
        fields=fields,
    )
    sink.emit(observation_event)


def _selection_options_from_request(request: LiveFrameRequest) -> LiveUwbSelectionOptions:
    """Map request selection options onto selector options."""
    selection_options = request.selection_options
    max_range_m = (
        selection_options.max_range_m
        if selection_options.max_range_m is not None
        else UNBOUNDED_RANGE_M
    )
    selector_options = LiveUwbSelectionOptions(
        max_links_per_agent=request.max_uwb_links_per_agent,
        max_range_m=max_range_m,
        add_range_m=selection_options.add_range_m,
        drop_range_m=selection_options.drop_range_m,
        max_graph_changes_per_frame=selection_options.max_graph_changes_per_frame,
        min_link_separation_deg=selection_options.min_link_separation_deg,
    )
    return selector_options


def _selection_positions(snapshot: LiveSensorSnapshot,
                         request: LiveFrameRequest) -> dict[str, tuple[float, float, float]]:
    """Return the non-truth positions used to shape UWB link selection.

    Ground truth must never inform selection geometry: in reality truth is
    unknown, so the angle gate, range gates, and ranking must run on what the
    estimator actually has. Positions come from the viewer's previous fused
    estimate when available and from the GNSS baseline otherwise. This function
    deliberately does not read ``snapshot.truth``.
    """
    positions = {measurement.agent_id: measurement.position_m for measurement in snapshot.gnss}
    
    for estimate in request.selection_options.previous_estimate:
        if estimate.agent_id in positions:
            positions[estimate.agent_id] = estimate.position_m
    return positions


def _select_uwb_links(snapshot: LiveSensorSnapshot,
                      request: LiveFrameRequest) -> LiveUwbSelection:
    """Run backend UWB selection over the snapshot candidates.

    Selection geometry uses estimated/GNSS positions only. The candidate range
    *values* handed to the solver stay truth-based (sensor readings); only the
    decision of which links to keep is made from non-truth geometry.
    """
    positions = _selection_positions(snapshot, request)
    selection = select_live_uwb_links(
        positions=positions,
        measurements=snapshot.uwb_candidates,
        options=_selection_options_from_request(request),
        previous_selected_links=request.selection_options.previous_selected_links,
    )
    return selection


def _solve_request_from_frame(request: LiveFrameRequest,
                              snapshot: LiveSensorSnapshot,
                              selection: LiveUwbSelection,
                              trace_context: TraceContext) -> LiveSolveRequest:
    """Convert the backend frame into a measurement-level solve request."""
    selected_keys = {
        stable_uwb_endpoint_key(link.source_id, link.target_id)
        for link in selection.selected_links
    }
    selected_measurements = [
        measurement
        for measurement in snapshot.uwb_candidates
        if stable_uwb_endpoint_key(measurement.source_id, measurement.target_id)
        in selected_keys
    ]
    solve_request = LiveSolveRequest(
        schema_version=request.schema_version,
        dimension=3,
        agents=list(snapshot.truth),
        gnss=list(snapshot.gnss),
        uwb=selected_measurements,
        selected_uwb_links=[
            SelectedUwbLink(source_id=link.source_id, target_id=link.target_id)
            for link in selection.selected_links
        ],
        estimation=LiveEstimationOptions(
            max_iterations=request.estimation.max_iterations,
            robust_loss=request.estimation.robust_loss,
        ),
        trace_context=trace_context.child(
            span_id=f"{trace_context.span_id}-solve",
        ),
    )
    return solve_request


def _snapshot_event_fields(request: LiveFrameRequest,
                           snapshot: LiveSensorSnapshot) -> dict[str, object]:
    """Summarize snapshot construction, including fallback usage."""
    supplied_offsets = set(request.sensor_options.gnss_offset_m_by_agent)
    supplied_sigmas = set(request.sensor_options.gnss_sigma_m_by_agent)
    fields = {
        "agent_count": len(snapshot.truth),
        "gnss_count": len(snapshot.gnss),
        "uwb_candidate_count": len(snapshot.uwb_candidates),
        "formation": request.mission_action.formation,
        "motion": request.mission_action.motion,
        "gnss_offset_fallback_count": sum(
            1 for state in snapshot.truth if state.agent_id not in supplied_offsets
        ),
        "gnss_sigma_fallback_count": sum(
            1 for state in snapshot.truth if state.agent_id not in supplied_sigmas
        ),
    }
    return fields


def build_live_frame(request: LiveFrameRequest,
                     observability_sink: ObservationSink | None = None,
                     solver_backend: SolverBackend | None = None) -> LiveFrameResponse:
    """Build, select, and solve one backend-owned live frame.

    Raises ``ValueError`` when frame building fails (for example a mission
    action that cannot generate positions for the requested agent count);
    the failure is emitted as ``live_frame_failed`` before re-raising.
    """
    sink = observability_sink or NoOpSink()
    trace_context = _root_frame_trace_context(request)
    started_seconds = perf_counter()
    _emit_event(
        sink,
        trace_context,
        "live_frame_request_started",
        fields={
            "agent_count": len(request.agent_ids),
            "time_s": request.time_s,
            "formation": request.mission_action.formation,
            "motion": request.mission_action.motion,
            "max_uwb_links_per_agent": request.max_uwb_links_per_agent,
            "previous_selected_links": len(
                request.selection_options.previous_selected_links
            ),
        },
    )

    try:
        snapshot = build_sensor_snapshot(request)
        _emit_event(
            sink,
            trace_context,
            "live_frame_snapshot_built",
            fields=_snapshot_event_fields(request, snapshot),
        )
        selection = _select_uwb_links(snapshot, request)
        _emit_event(
            sink,
            trace_context,
            "live_frame_uwb_selected",
            fields=selection.diagnostics.model_dump(),
        )
        solve_request = _solve_request_from_frame(
            request,
            snapshot,
            selection,
            trace_context,
        )
        solve_response = solve_live_request(
            solve_request,
            observability_sink=sink,
            solver_backend=solver_backend,
        )
        frame_response = LiveFrameResponse(
            schema_version=request.schema_version,
            metadata=LiveFrameMetadata(
                solver=solve_response.metadata.solver,
                formation=request.mission_action.formation,
                motion=request.mission_action.motion,
                time_s=request.time_s,
                selected_uwb_count=solve_response.metadata.selected_uwb_count,
                trace_context=trace_context.model_dump(mode="json"),
            ),
            truth=list(snapshot.truth),
            measurements=LiveFrameMeasurementSection(
                gnss=list(snapshot.gnss),
                uwb=list(solve_request.uwb),
            ),
            selected_uwb_links=list(selection.selected_links),
            uwb_selection=selection.diagnostics,
            estimates=solve_response.estimates,
            trace=solve_response.trace,
            constraints=solve_response.constraints,
            quality=solve_response.metadata.quality,
        )
        duration_ms = (perf_counter() - started_seconds) * 1000.0
        _emit_event(
            sink,
            trace_context,
            "live_frame_completed",
            fields={
                "solver": solve_response.metadata.solver,
                "selected_uwb_count": solve_response.metadata.selected_uwb_count,
                "agent_count": len(snapshot.truth),
            },
            duration_ms=duration_ms,
        )
        return frame_response
    except Exception as error:
        _emit_event(
            sink,
            trace_context,
            "live_frame_failed",
            fields={
                "error_type": type(error).__name__,
                "error": str(error),
            },
            duration_ms=(perf_counter() - started_seconds) * 1000.0,
        )
        raise
