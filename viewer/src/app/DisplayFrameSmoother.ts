import type { Position3D } from "../animation/liveMotion";
import type { LiveSolveResponse } from "../live/liveSolveTypes";
import type { LiveEstimationFrame } from "../simulation/liveEstimation";
import type { MissionActionState } from "../simulation/missionActions";

export type DisplaySmoothingReason =
  | "formation_change"
  | "drone_count_change"
  | "topology_change"
  | "backend_frame_gap"
  | "recent_slow_frames";

export interface DisplaySmoothingDiagnostics {
  active: boolean;
  reason: DisplaySmoothingReason | null;
  ageMs: number;
  windowMs: number;
}

export interface DisplayPositionOverrides {
  fused?: Map<string, Position3D>;
  gnssOnly?: Map<string, Position3D>;
}

export interface DisplayFrameSmootherInput {
  liveFrame: LiveEstimationFrame;
  displayFrame: LiveSolveResponse | null;
  missionAction: MissionActionState;
  missionDroneCount: number;
  selectedUwbLinkCount: number;
  latestSolvedFrameAgeMs: number | null;
  recentFrameWasSlow: boolean;
  nowMs: number;
}

export interface DisplayFrameSmootherOutput {
  liveFrame: LiveEstimationFrame;
  displayPositions: DisplayPositionOverrides;
  diagnostics: DisplaySmoothingDiagnostics;
}

interface SmootherContext {
  formation: MissionActionState["formation"];
  missionDroneCount: number;
  selectedUwbLinkCount: number;
  latestSolvedFrameAgeMs: number | null;
}

type PositionSource = "truth" | "gnss" | "fused" | "gnssOnly";

const formationWindowMs = 120;
const droneCountWindowMs = 180;
const topologyWindowMs = 120;
const backendFrameGapWindowMs = 90;
const recentSlowFrameWindowMs = 90;
const topologyJumpThreshold = 3;
const staleBackendAgeMs = 500;
const freshBackendAgeMs = 120;
const assumedFrameStepMs = 16;

function easeOutCubic(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  const easedProgress = 1 - (1 - t) ** 3;
  return easedProgress;
}

function clonePosition(position: Position3D): Position3D {
  const clonedPosition: Position3D = [position[0], position[1], position[2]];
  return clonedPosition;
}

function lerpPosition(from: Position3D,
                      to: Position3D,
                      progress: number): Position3D {
  const t = easeOutCubic(progress);
  const position: Position3D = [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t
  ];
  return position;
}

function positionsFromEstimates(
  estimates: Array<{ agent_id: string; position_m: number[] }>
): Map<string, Position3D> {
  const positions = new Map<string, Position3D>();
  for (const estimate of estimates) {
    positions.set(estimate.agent_id, [
      estimate.position_m[0] ?? 0,
      estimate.position_m[1] ?? 0,
      estimate.position_m[2] ?? 0
    ]);
  }
  return positions;
}

function nearestPreviousPosition(target: Position3D,
                                 previous: Map<string, Position3D>): Position3D | null {
  let nearestPosition: Position3D | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of previous.values()) {
    const distance = Math.hypot(
      candidate[0] - target[0],
      candidate[1] - target[1],
      candidate[2] - target[2]
    );
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestPosition = candidate;
    }
  }
  return nearestPosition;
}

function clonePositionMap(positions: Map<string, Position3D>): Map<string, Position3D> {
  const clonedPositions = new Map<string, Position3D>();
  for (const [agentId, position] of positions.entries()) {
    clonedPositions.set(agentId, clonePosition(position));
  }
  return clonedPositions;
}

function contextFrom(input: DisplayFrameSmootherInput): SmootherContext {
  const context = {
    formation: input.missionAction.formation,
    missionDroneCount: input.missionDroneCount,
    selectedUwbLinkCount: input.selectedUwbLinkCount,
    latestSolvedFrameAgeMs: input.latestSolvedFrameAgeMs
  };
  return context;
}

function reasonWindow(reason: DisplaySmoothingReason): number {
  if (reason === "drone_count_change") {
    return droneCountWindowMs;
  }
  if (reason === "formation_change") {
    return formationWindowMs;
  }
  if (reason === "topology_change") {
    return topologyWindowMs;
  }
  if (reason === "backend_frame_gap") {
    return backendFrameGapWindowMs;
  }
  return recentSlowFrameWindowMs;
}

function triggerReason(previous: SmootherContext | null,
                       input: DisplayFrameSmootherInput): DisplaySmoothingReason | null {
  if (!previous) {
    return null;
  }
  if (input.missionDroneCount !== previous.missionDroneCount) {
    return "drone_count_change";
  }
  if (input.missionAction.formation !== previous.formation) {
    return "formation_change";
  }
  if (
    Math.abs(input.selectedUwbLinkCount - previous.selectedUwbLinkCount)
    >= topologyJumpThreshold
  ) {
    return "topology_change";
  }
  if (
    previous.latestSolvedFrameAgeMs !== null
    && previous.latestSolvedFrameAgeMs >= staleBackendAgeMs
    && input.latestSolvedFrameAgeMs !== null
    && input.latestSolvedFrameAgeMs <= freshBackendAgeMs
  ) {
    return "backend_frame_gap";
  }
  if (input.recentFrameWasSlow) {
    return "recent_slow_frames";
  }
  return null;
}

export class DisplayFrameSmoother {
  private previousContext: SmootherContext | null;
  private activeReason: DisplaySmoothingReason | null;
  private activeStartedAtMs: number;
  private activeWindowMs: number;
  private lastRenderedPositions: Record<PositionSource, Map<string, Position3D>>;
  private transitionStartPositions: Record<PositionSource, Map<string, Position3D>>;

  constructor() {
    this.previousContext = null;
    this.activeReason = null;
    this.activeStartedAtMs = 0;
    this.activeWindowMs = 0;
    this.lastRenderedPositions = {
      truth: new Map(),
      gnss: new Map(),
      fused: new Map(),
      gnssOnly: new Map()
    };
    this.transitionStartPositions = {
      truth: new Map(),
      gnss: new Map(),
      fused: new Map(),
      gnssOnly: new Map()
    };
  }

  update(input: DisplayFrameSmootherInput): DisplayFrameSmootherOutput {
    const fusedPositions = input.displayFrame
      ? positionsFromEstimates(input.displayFrame.estimates.fused)
      : new Map<string, Position3D>();
    const gnssOnlyPositions = input.displayFrame
      ? positionsFromEstimates(input.displayFrame.estimates.gnss_only)
      : new Map<string, Position3D>();
    const reason = triggerReason(this.previousContext, input);
    if (reason) {
      this.activeReason = reason;
      this.activeWindowMs = reasonWindow(reason);
      this.activeStartedAtMs = input.nowMs - assumedFrameStepMs;
      this.transitionStartPositions = {
        truth: clonePositionMap(this.lastRenderedPositions.truth),
        gnss: clonePositionMap(this.lastRenderedPositions.gnss),
        fused: clonePositionMap(this.lastRenderedPositions.fused),
        gnssOnly: clonePositionMap(this.lastRenderedPositions.gnssOnly)
      };
    }

    const rawAgeMs = this.activeReason ? input.nowMs - this.activeStartedAtMs : 0;
    const ageMs = Math.max(0, rawAgeMs);
    const active = (
      this.activeReason !== null
      && this.activeWindowMs > 0
      && ageMs < this.activeWindowMs
    );
    const progress = active ? ageMs / this.activeWindowMs : 1;
    const liveFrame = active
      ? this.smoothedLiveFrame(input.liveFrame, progress)
      : input.liveFrame;
    const displayPositions = active
      ? this.smoothedDisplayPositions(fusedPositions, gnssOnlyPositions, progress)
      : {};

    this.rememberRenderedPositions(liveFrame, displayPositions, fusedPositions, gnssOnlyPositions);
    this.previousContext = contextFrom(input);

    const diagnostics = {
      active,
      reason: active ? this.activeReason : null,
      ageMs: active ? ageMs : 0,
      windowMs: active ? this.activeWindowMs : 0
    };
    if (!active) {
      this.activeReason = null;
      this.activeWindowMs = 0;
    }

    const output = {
      liveFrame,
      displayPositions,
      diagnostics
    };
    return output;
  }

  private smoothedLiveFrame(liveFrame: LiveEstimationFrame,
                            progress: number): LiveEstimationFrame {
    const smoothedFrame = {
      ...liveFrame,
      truthPositions: this.smoothMap("truth", liveFrame.truthPositions, progress),
      gnssPositions: this.smoothMap("gnss", liveFrame.gnssPositions, progress)
    };
    return smoothedFrame;
  }

  private smoothedDisplayPositions(fusedPositions: Map<string, Position3D>,
                                   gnssOnlyPositions: Map<string, Position3D>,
                                   progress: number): DisplayPositionOverrides {
    const displayPositions: DisplayPositionOverrides = {};
    if (fusedPositions.size > 0) {
      displayPositions.fused = this.smoothMap("fused", fusedPositions, progress);
    }
    if (gnssOnlyPositions.size > 0) {
      displayPositions.gnssOnly = this.smoothMap("gnssOnly", gnssOnlyPositions, progress);
    }
    return displayPositions;
  }

  private smoothMap(source: PositionSource,
                    targetPositions: Map<string, Position3D>,
                    progress: number): Map<string, Position3D> {
    const startPositions = this.transitionStartPositions[source];
    const previousPositions = this.lastRenderedPositions[source];
    const smoothedPositions = new Map<string, Position3D>();
    for (const [agentId, targetPosition] of targetPositions.entries()) {
      const startPosition = (
        startPositions.get(agentId)
        ?? nearestPreviousPosition(targetPosition, previousPositions)
        ?? targetPosition
      );
      smoothedPositions.set(agentId, lerpPosition(startPosition, targetPosition, progress));
    }
    return smoothedPositions;
  }

  private rememberRenderedPositions(liveFrame: LiveEstimationFrame,
                                    displayPositions: DisplayPositionOverrides,
                                    rawFusedPositions: Map<string, Position3D>,
                                    rawGnssOnlyPositions: Map<string, Position3D>): void {
    this.lastRenderedPositions.truth = clonePositionMap(liveFrame.truthPositions);
    this.lastRenderedPositions.gnss = clonePositionMap(liveFrame.gnssPositions);
    this.lastRenderedPositions.fused = clonePositionMap(
      displayPositions.fused ?? rawFusedPositions
    );
    this.lastRenderedPositions.gnssOnly = clonePositionMap(
      displayPositions.gnssOnly ?? rawGnssOnlyPositions
    );
  }
}
