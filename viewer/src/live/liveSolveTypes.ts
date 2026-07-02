import type { SceneTrace } from "../data/sceneTypes";
import type { LiveEstimationFrame } from "../simulation/liveEstimation";

export type LiveRobustLoss = "linear" | "soft_l1" | "huber" | "cauchy" | "arctan";
export type UwbConstraintState = "no_uwb" | "weak_uwb" | "multi_uwb";
export type UwbGraphSupport = "none" | "weak_range" | "chain" | "triangle" | "graph";

export interface LiveAgentState {
  agent_id: string;
  position_m: number[];
}

export interface LiveGnssMeasurement {
  agent_id: string;
  position_m: number[];
  sigma_m: number;
}

export interface LiveUwbMeasurement {
  source_id: string;
  target_id: string;
  distance_m: number;
  sigma_m: number;
  true_distance_m?: number | null;
}

export interface SelectedUwbLink {
  source_id: string;
  target_id: string;
}

export interface LiveEstimationOptions {
  max_iterations: number;
  robust_loss: LiveRobustLoss;
}

export interface LiveTraceContext {
  session_id: string;
  trace_id: string;
  span_id: string;
  parent_span_id?: string | null;
  correlation_id?: string | null;
  request_id?: string | null;
  run_id?: string | null;
  scenario?: string | null;
}

export interface LiveSolveRequest {
  schema_version: string;
  dimension: number;
  agents: LiveAgentState[];
  gnss: LiveGnssMeasurement[];
  uwb: LiveUwbMeasurement[];
  selected_uwb_links: SelectedUwbLink[];
  estimation: LiveEstimationOptions;
  trace_context?: LiveTraceContext;
}

export interface LivePositionEstimate {
  agent_id: string;
  position_m: number[];
}

export interface LiveTraceIteration {
  iteration: number;
  positions: Record<string, number[]>;
  cost_total: number;
  cost_gnss: number;
  cost_uwb: number;
  gnss_residuals: Array<{
    agent_id: string;
    vector: number[];
    norm: number;
    weighted_sq: number;
  }>;
  uwb_residuals: Array<{
    source_id: string;
    target_id: string;
    residual_m: number;
    weighted_sq: number;
  }>;
}

export interface LiveConstraintNode {
  agent_id: string;
  selected_uwb_degree: number;
  constraint_state: UwbConstraintState;
  graph_support?: UwbGraphSupport;
}

export interface LiveConstraintEdge {
  source_id: string;
  target_id: string;
  measured_distance_m: number;
  sigma_m: number;
  residual_m: number | null;
  weighted_sq: number | null;
  measurement_type: "distance_constraint";
}

export interface LiveSolveResponse {
  schema_version: string;
  metadata: {
    solver: string;
    selected_uwb_count: number;
    trace_context?: LiveTraceContext | null;
  };
  truth: LiveAgentState[];
  measurements: {
    gnss: Record<string, unknown>[];
    uwb: Record<string, unknown>[];
  };
  estimates: {
    fused: LivePositionEstimate[];
    gnss_only: LivePositionEstimate[];
  };
  trace: {
    trace_type: string;
    iterations: LiveTraceIteration[];
  };
  constraints: {
    nodes: LiveConstraintNode[];
    edges: LiveConstraintEdge[];
  };
}

export function buildLiveSolveRequest(sceneTrace: SceneTrace,
                                      liveFrame: LiveEstimationFrame,
                                      _maxUwbLinksPerAgent: number): LiveSolveRequest {
  const agents = Array.from(liveFrame.truthPositions.entries()).map(
    ([agentId, position]) => ({ agent_id: agentId, position_m: position })
  );
  const gnss = Array.from(liveFrame.gnssPositions.entries()).map(
    ([agentId, position]) => ({
      agent_id: agentId,
      position_m: position,
      sigma_m: liveFrame.gnssSigma.get(agentId) ?? 1
    })
  );
  const selectedLinks = liveFrame.uwbLinks;
  const uwb = selectedLinks.map((link) => ({
    source_id: link.sourceId,
    target_id: link.targetId,
    distance_m: link.measuredDistanceM,
    sigma_m: link.sigmaM,
    true_distance_m: null
  }));
  const selected_uwb_links = selectedLinks.map((link) => ({
    source_id: link.sourceId,
    target_id: link.targetId
  }));
  const request = {
    schema_version: sceneTrace.schema_version,
    dimension: 3,
    agents,
    gnss,
    uwb,
    selected_uwb_links,
    estimation: {
      max_iterations: 40,
      robust_loss: "linear" as LiveRobustLoss
    }
  };
  return request;
}

function exportedConstraintState(degree: number): UwbConstraintState {
  if (degree === 0) {
    return "no_uwb";
  }
  if (degree === 1) {
    return "weak_uwb";
  }
  return "multi_uwb";
}

function exportedGraphSupport(degree: number): UwbGraphSupport {
  if (degree === 0) {
    return "none";
  }
  if (degree === 1) {
    return "weak_range";
  }
  return "chain";
}

export function buildInitialLiveSolveResponse(sceneTrace: SceneTrace): LiveSolveResponse {
  const degreeByAgent = new Map<string, number>();
  for (const node of sceneTrace.truth.nodes) {
    degreeByAgent.set(node.id, 0);
  }

  const latestIteration = sceneTrace.trace.iterations[sceneTrace.trace.iterations.length - 1];
  const uwbResiduals = new Map<string, { residual_m: number; weighted_sq: number }>();
  if (latestIteration) {
    for (const residual of latestIteration.residuals.uwb) {
      const edgeKey = [residual.source_id, residual.target_id].sort().join("::");
      uwbResiduals.set(edgeKey, {
        residual_m: residual.residual_m,
        weighted_sq: residual.weighted_sq
      });
    }
  }

  const edges = sceneTrace.measurements.uwb.map((measurement) => {
    degreeByAgent.set(
      measurement.source_id,
      (degreeByAgent.get(measurement.source_id) ?? 0) + 1
    );
    degreeByAgent.set(
      measurement.target_id,
      (degreeByAgent.get(measurement.target_id) ?? 0) + 1
    );
    const edgeKey = [measurement.source_id, measurement.target_id].sort().join("::");
    const residual = uwbResiduals.get(edgeKey);
    const edge = {
      source_id: measurement.source_id,
      target_id: measurement.target_id,
      measured_distance_m: measurement.measured_distance_m,
      sigma_m: measurement.sigma_m,
      residual_m: residual?.residual_m ?? null,
      weighted_sq: residual?.weighted_sq ?? null,
      measurement_type: "distance_constraint" as const
    };
    return edge;
  });

  const traceIterations = sceneTrace.trace.iterations.map((iteration) => ({
    iteration: iteration.iteration,
    positions: iteration.positions,
    cost_total: iteration.cost.total,
    cost_gnss: iteration.cost.gnss,
    cost_uwb: iteration.cost.uwb,
    gnss_residuals: iteration.residuals.gnss,
    uwb_residuals: iteration.residuals.uwb
  }));
  const response = {
    schema_version: sceneTrace.schema_version,
    metadata: {
      solver: "exported-scene-trace",
      selected_uwb_count: sceneTrace.measurements.uwb.length
    },
    truth: sceneTrace.truth.nodes.map((node) => ({
      agent_id: node.id,
      position_m: node.position_m
    })),
    measurements: {
      gnss: sceneTrace.measurements.gnss.map((measurement) => ({ ...measurement })),
      uwb: sceneTrace.measurements.uwb.map((measurement) => ({ ...measurement }))
    },
    estimates: {
      fused: sceneTrace.estimates.fused ?? [],
      gnss_only: sceneTrace.estimates.gnss_only ?? []
    },
    trace: {
      trace_type: sceneTrace.trace.trace_type,
      iterations: traceIterations
    },
    constraints: {
      nodes: Array.from(degreeByAgent.entries()).map(([agentId, degree]) => ({
        agent_id: agentId,
        selected_uwb_degree: degree,
        constraint_state: exportedConstraintState(degree),
        graph_support: exportedGraphSupport(degree)
      })),
      edges
    }
  };
  return response;
}

export function fusedPositionMap(response: LiveSolveResponse | null): Map<string, number[]> {
  const positions = new Map<string, number[]>();
  if (!response) {
    return positions;
  }

  for (const estimate of response.estimates.fused) {
    positions.set(estimate.agent_id, estimate.position_m);
  }
  return positions;
}

export function gnssOnlyPositionMap(response: LiveSolveResponse | null): Map<string, number[]> {
  const positions = new Map<string, number[]>();
  if (!response) {
    return positions;
  }

  for (const estimate of response.estimates.gnss_only) {
    positions.set(estimate.agent_id, estimate.position_m);
  }
  return positions;
}

export function uwbConstraintNodeMap(response: LiveSolveResponse | null): Map<string, LiveConstraintNode> {
  const nodes = new Map<string, LiveConstraintNode>();
  if (!response) {
    return nodes;
  }

  for (const node of response.constraints.nodes) {
    nodes.set(node.agent_id, node);
  }
  return nodes;
}

export function latestTraceIteration(response: LiveSolveResponse | null): LiveTraceIteration | null {
  if (!response || response.trace.iterations.length === 0) {
    return null;
  }

  const iteration = response.trace.iterations[response.trace.iterations.length - 1];
  return iteration;
}
