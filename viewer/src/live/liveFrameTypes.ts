/**
 * Types and converters for backend-owned live frames (BLF-005).
 *
 * The viewer sends mission intent and options to `POST /live/frame` and
 * receives a complete render-ready frame: truth, GNSS, UWB, selected links,
 * selection diagnostics, estimates, trace, constraints, and quality. These
 * types mirror the backend contracts in `swarmfix/live/models.py`.
 *
 * Sensor policy note: per the BLF-002 migration plan, the viewer derives
 * scene-based GNSS offsets and sigma fallbacks here and sends them as
 * request *options*; the backend generates all measurements. The derivation
 * mirrors the historical local live-frame behavior so solve inputs stay
 * identical across the migration.
 */

import type { Position3D } from "../animation/liveMotion";
import { liftPositionTo3D } from "../animation/liveMotion";
import type { SceneTrace } from "../data/sceneTypes";
import type { LiveEstimationFrame } from "../simulation/liveEstimation";
import type { SelectedLiveUwbLink } from "../simulation/uwbLinkSelection";
import {
  normalizeMissionActionState,
  type MissionActionState
} from "../simulation/missionActions";
import type {
  LiveAgentState,
  LiveGnssMeasurement,
  LiveSolveRequest,
  LiveSolveResponse,
  LiveTraceContext,
  LiveUwbMeasurement
} from "./liveSolveTypes";

export const LIVE_FRAME_ESTIMATION_DEFAULTS = {
  max_iterations: 40,
  robust_loss: "linear"
} as const;

export interface LiveFrameSensorOptions {
  gnss_offset_m_by_agent: Record<string, [number, number, number]>;
  gnss_sigma_m_by_agent: Record<string, number>;
  uwb_sigma_m_by_link: Record<string, number>;
  gnss_fallback_sigma_m: number;
  uwb_fallback_sigma_m: number;
}

export interface LiveFrameSelectionOptions {
  max_range_m: number | null;
  add_range_m: number | null;
  drop_range_m: number | null;
  max_graph_changes_per_frame: number;
  min_link_separation_deg: number;
  previous_selected_links: Array<{ source_id: string; target_id: string }>;
  previous_estimate: Array<{ agent_id: string; position_m: number[] }>;
}

export interface LiveFrameRequest {
  schema_version: string;
  agent_ids: string[];
  time_s: number;
  mission_action: Record<string, unknown>;
  max_uwb_links_per_agent: number;
  sensor_options: LiveFrameSensorOptions;
  selection_options: LiveFrameSelectionOptions;
  estimation: { max_iterations: number; robust_loss: string };
  trace_context?: LiveTraceContext;
}

export interface LiveFrameSelectedLink {
  source_id: string;
  target_id: string;
  measured_distance_m: number;
  sigma_m: number;
  selection_reason: "retained" | "new";
}

export interface LiveFrameUwbSelectionDiagnostics {
  candidate_link_count: number;
  selected_link_count: number;
  max_links_per_agent: number;
  connected_component_count: number;
  isolated_agent_count: number;
  triangle_count: number;
  added_links: number;
  dropped_links: number;
  selection_policy: string;
  adaptive_selection_enabled: boolean;
}

export interface LiveFrameResponse {
  schema_version: string;
  metadata: {
    solver: string;
    formation: string;
    motion: string;
    time_s: number;
    selected_uwb_count: number;
    trace_context?: LiveTraceContext | null;
  };
  truth: LiveAgentState[];
  measurements: {
    gnss: LiveGnssMeasurement[];
    uwb: LiveUwbMeasurement[];
  };
  selected_uwb_links: LiveFrameSelectedLink[];
  uwb_selection: LiveFrameUwbSelectionDiagnostics;
  estimates: LiveSolveResponse["estimates"];
  trace: LiveSolveResponse["trace"];
  constraints: LiveSolveResponse["constraints"];
  quality?: NonNullable<LiveSolveResponse["metadata"]["quality"]> | null;
}

function stableEndpointKey(sourceId: string,
                           targetId: string): string {
  const endpoints = [sourceId, targetId].sort();
  const endpointKey = `${endpoints[0]}::${endpoints[1]}`;
  return endpointKey;
}

function medianPositiveSigma(sigmaValues: number[],
                             fallbackSigmaM: number): number {
  const positiveSigmas = sigmaValues
    .filter((sigmaM) => Number.isFinite(sigmaM) && sigmaM > 0)
    .sort((firstSigma, secondSigma) => firstSigma - secondSigma);
  if (positiveSigmas.length === 0) {
    return fallbackSigmaM;
  }

  const middleIndex = Math.floor(positiveSigmas.length / 2);
  const medianSigmaM = positiveSigmas[middleIndex];
  return medianSigmaM;
}

/**
 * Derive scene-based sensor policy for the live-frame request, mirroring
 * the offsets and sigma fallbacks the local live-frame builder used.
 */
export function deriveLiveFrameSensorOptions(sceneTrace: SceneTrace): LiveFrameSensorOptions {
  const truthPositions = new Map<string, Position3D>();
  for (const node of sceneTrace.truth.nodes) {
    truthPositions.set(node.id, liftPositionTo3D(node.position_m));
  }

  const gnssOffsets: Record<string, [number, number, number]> = {};
  const gnssSigmas: Record<string, number> = {};
  for (const measurement of sceneTrace.measurements.gnss) {
    gnssSigmas[measurement.agent_id] = measurement.sigma_m;
    const truthPosition = truthPositions.get(measurement.agent_id);
    if (!truthPosition) {
      continue;
    }
    const gnssPosition = liftPositionTo3D(measurement.position_m);
    gnssOffsets[measurement.agent_id] = [
      gnssPosition[0] - truthPosition[0],
      gnssPosition[1] - truthPosition[1],
      gnssPosition[2] - truthPosition[2]
    ];
  }

  const uwbSigmas: Record<string, number> = {};
  for (const measurement of sceneTrace.measurements.uwb) {
    uwbSigmas[stableEndpointKey(measurement.source_id, measurement.target_id)] = (
      measurement.sigma_m
    );
  }

  const sensorOptions: LiveFrameSensorOptions = {
    gnss_offset_m_by_agent: gnssOffsets,
    gnss_sigma_m_by_agent: gnssSigmas,
    uwb_sigma_m_by_link: uwbSigmas,
    gnss_fallback_sigma_m: medianPositiveSigma(
      sceneTrace.measurements.gnss.map((measurement) => measurement.sigma_m),
      1.0
    ),
    uwb_fallback_sigma_m: medianPositiveSigma(
      sceneTrace.measurements.uwb.map((measurement) => measurement.sigma_m),
      0.1
    )
  };
  return sensorOptions;
}

export interface BuildLiveFrameRequestInput {
  sceneTrace: SceneTrace;
  agentIds: string[];
  timeSeconds: number;
  missionAction: MissionActionState;
  maxUwbLinksPerAgent: number;
  previousSelectedLinks: Array<{ sourceId: string; targetId: string }>;
  previousEstimate?: Array<{ agent_id: string; position_m: number[] }>;
}

/**
 * Build one backend live-frame request from viewer intent and options.
 *
 * The request carries no measurements: previous selected links are echoed
 * as hysteresis state transport only, and the backend selector decides
 * which links survive.
 */
export function buildLiveFrameRequest(input: BuildLiveFrameRequestInput): LiveFrameRequest {
  const normalizedAction = normalizeMissionActionState(input.missionAction);
  const request: LiveFrameRequest = {
    schema_version: input.sceneTrace.schema_version,
    agent_ids: input.agentIds,
    time_s: input.timeSeconds,
    mission_action: {
      formation: normalizedAction.formation,
      motion: normalizedAction.motion,
      speed_mps: normalizedAction.speedMps,
      random_walk_amplitude_m: normalizedAction.randomWalkAmplitudeM,
      path: normalizedAction.path,
      previous_formation: normalizedAction.previousFormation,
      transition_started_at_s: normalizedAction.transitionStartedAtS,
      transition_duration_s: normalizedAction.transitionDurationS
    },
    max_uwb_links_per_agent: input.maxUwbLinksPerAgent,
    sensor_options: deriveLiveFrameSensorOptions(input.sceneTrace),
    selection_options: {
      max_range_m: null,
      add_range_m: null,
      drop_range_m: null,
      max_graph_changes_per_frame: 2,
      min_link_separation_deg: 10,
      previous_selected_links: input.previousSelectedLinks.map((link) => ({
        source_id: link.sourceId,
        target_id: link.targetId
      })),
      previous_estimate: (input.previousEstimate ?? []).map((estimate) => ({
        agent_id: estimate.agent_id,
        position_m: estimate.position_m
      }))
    },
    estimation: { ...LIVE_FRAME_ESTIMATION_DEFAULTS }
  };
  return request;
}

/**
 * Adapt a backend live frame into the LiveSolveResponse shape so the
 * existing scheduler, interpolation, plots, and inspectors keep working.
 */
export function liveSolveResponseFromLiveFrame(frame: LiveFrameResponse): LiveSolveResponse {
  const response: LiveSolveResponse = {
    schema_version: frame.schema_version,
    metadata: {
      solver: frame.metadata.solver,
      selected_uwb_count: frame.metadata.selected_uwb_count,
      trace_context: frame.metadata.trace_context ?? null,
      quality: frame.quality ?? null
    },
    truth: frame.truth,
    measurements: {
      gnss: frame.measurements.gnss as unknown as Record<string, unknown>[],
      uwb: frame.measurements.uwb as unknown as Record<string, unknown>[]
    },
    estimates: frame.estimates,
    trace: frame.trace,
    constraints: frame.constraints
  };
  return response;
}

/**
 * Rebuild the measurement-level /solve request equivalent of a backend
 * frame, used by Newton diagnostics without local measurement generation.
 */
export function liveSolveRequestFromLiveFrame(frame: LiveFrameResponse): LiveSolveRequest {
  const request: LiveSolveRequest = {
    schema_version: frame.schema_version,
    dimension: 3,
    agents: frame.truth,
    gnss: frame.measurements.gnss,
    uwb: frame.measurements.uwb,
    selected_uwb_links: frame.selected_uwb_links.map((link) => ({
      source_id: link.source_id,
      target_id: link.target_id
    })),
    estimation: { ...LIVE_FRAME_ESTIMATION_DEFAULTS } as LiveSolveRequest["estimation"]
  };
  return request;
}

export function selectedLiveUwbLinksFromFrame(frame: LiveFrameResponse): SelectedLiveUwbLink[] {
  const selectedLinks = frame.selected_uwb_links.map((link) => ({
    sourceId: link.source_id,
    targetId: link.target_id,
    measuredDistanceM: link.measured_distance_m,
    sigmaM: link.sigma_m,
    selectionReason: link.selection_reason
  }));
  return selectedLinks;
}

export function uwbSelectionDiagnosticsFromFrame(frame: LiveFrameResponse): LiveEstimationFrame["uwbSelection"] {
  const diagnostics = {
    candidateLinkCount: frame.uwb_selection.candidate_link_count,
    selectedLinkCount: frame.uwb_selection.selected_link_count,
    maxLinksPerAgent: frame.uwb_selection.max_links_per_agent,
    connectedComponentCount: frame.uwb_selection.connected_component_count,
    isolatedAgentCount: frame.uwb_selection.isolated_agent_count,
    triangleCount: frame.uwb_selection.triangle_count,
    addedLinks: frame.uwb_selection.added_links,
    droppedLinks: frame.uwb_selection.dropped_links,
    selectionPolicy: "adaptive_range_graph_v1" as const,
    adaptiveSelectionEnabled: true as const
  };
  return diagnostics;
}

function toPosition3D(positionM: number[]): Position3D {
  const position: Position3D = [
    positionM[0] ?? 0,
    positionM[1] ?? 0,
    positionM[2] ?? 0
  ];
  return position;
}

/**
 * Convert a backend live frame into the render-frame shape the scene
 * runtime consumes. When display-cadence truth positions are supplied
 * (backend mission positions refreshed faster than solves), they override
 * the frame's solver-snapshot truth for smooth marker motion; GNSS, UWB
 * links, and diagnostics always come from the backend frame.
 */
export function liveEstimationFrameFromLiveFrame(frame: LiveFrameResponse,
                                                 displayTruthPositions: Map<string, Position3D> | null = null): LiveEstimationFrame {
  const truthPositions = new Map<string, Position3D>();
  for (const state of frame.truth) {
    truthPositions.set(state.agent_id, toPosition3D(state.position_m));
  }
  if (displayTruthPositions) {
    for (const [agentId, position] of displayTruthPositions.entries()) {
      if (truthPositions.has(agentId)) {
        truthPositions.set(agentId, position);
      }
    }
  }

  const gnssPositions = new Map<string, Position3D>();
  const gnssSigma = new Map<string, number>();
  for (const measurement of frame.measurements.gnss) {
    gnssPositions.set(measurement.agent_id, toPosition3D(measurement.position_m));
    gnssSigma.set(measurement.agent_id, measurement.sigma_m);
  }

  const liveFrame: LiveEstimationFrame = {
    truthPositions,
    gnssPositions,
    gnssSigma,
    uwbLinks: selectedLiveUwbLinksFromFrame(frame),
    uwbSelection: uwbSelectionDiagnosticsFromFrame(frame)
  };
  return liveFrame;
}
