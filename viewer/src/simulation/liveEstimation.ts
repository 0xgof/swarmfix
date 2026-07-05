import {
  animatedSwarmPosition,
  liftPositionTo3D,
  type Position3D
} from "../animation/liveMotion";
import type { SceneTrace } from "../data/sceneTypes";
import type { UwbMeasurement } from "../data/sceneTypes";
import type { MissionActionState } from "./missionActions";
import {
  selectLiveUwbLinks,
  type LiveUwbSelectionDiagnostics,
  type SelectedLiveUwbLink
} from "./uwbLinkSelection";

const DEFAULT_LIVE_UWB_RANGE_M = Number.POSITIVE_INFINITY;
const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;
const UINT32_MAX = 0xffffffff;

export interface LiveUwbLink {
  sourceId: string;
  targetId: string;
  measuredDistanceM: number;
  sigmaM: number;
  selectionReason: "retained" | "new";
}

export interface LiveEstimationFrame {
  truthPositions: Map<string, Position3D>;
  gnssPositions: Map<string, Position3D>;
  gnssSigma: Map<string, number>;
  uwbLinks: LiveUwbLink[];
  uwbSelection: LiveUwbSelectionDiagnostics;
}

export interface LiveUwbSelectionOverrides {
  maxRangeM?: number;
  addRangeM?: number;
  dropRangeM?: number;
  maxGraphChangesPerFrame?: number;
}

function distance3D(a: Position3D,
                    b: Position3D): number {
  const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  return distance;
}

function endpointKey(sourceId: string,
                     targetId: string): string {
  const endpoints = [sourceId, targetId].sort();
  const key = `${endpoints[0]}::${endpoints[1]}`;
  return key;
}

function defaultUwbSigma(sceneTrace: SceneTrace): number {
  const sigmaValues = sceneTrace.measurements.uwb
    .map((measurement) => measurement.sigma_m)
    .filter((sigmaM) => Number.isFinite(sigmaM) && sigmaM > 0)
    .sort((firstSigma, secondSigma) => firstSigma - secondSigma);
  if (sigmaValues.length === 0) {
    return 0.1;
  }

  const middleIndex = Math.floor(sigmaValues.length / 2);
  const sigmaM = sigmaValues[middleIndex];
  return sigmaM;
}

function liveUwbCandidates(sceneTrace: SceneTrace,
                           truthPositions: Map<string, Position3D>): UwbMeasurement[] {
  const sigmaByEndpoint = new Map<string, number>();
  for (const measurement of sceneTrace.measurements.uwb) {
    sigmaByEndpoint.set(
      endpointKey(measurement.source_id, measurement.target_id),
      measurement.sigma_m
    );
  }

  const fallbackSigmaM = defaultUwbSigma(sceneTrace);
  const agentIds = [...truthPositions.keys()].sort((firstId, secondId) => (
    firstId.localeCompare(secondId, undefined, { numeric: true })
  ));
  const candidates: UwbMeasurement[] = [];
  for (let sourceIndex = 0; sourceIndex < agentIds.length; sourceIndex += 1) {
    for (let targetIndex = sourceIndex + 1; targetIndex < agentIds.length; targetIndex += 1) {
      const sourceId = agentIds[sourceIndex];
      const targetId = agentIds[targetIndex];
      const sourcePosition = truthPositions.get(sourceId);
      const targetPosition = truthPositions.get(targetId);
      if (!sourcePosition || !targetPosition) {
        continue;
      }

      const distanceM = distance3D(sourcePosition, targetPosition);
      candidates.push({
        source_id: sourceId,
        target_id: targetId,
        measured_distance_m: distanceM,
        sigma_m: sigmaByEndpoint.get(endpointKey(sourceId, targetId)) ?? fallbackSigmaM,
        true_distance_m: distanceM
      });
    }
  }

  return candidates;
}

function nominalTruthPositions(sceneTrace: SceneTrace): Map<string, Position3D> {
  const positions = new Map<string, Position3D>();
  for (const node of sceneTrace.truth.nodes) {
    positions.set(node.id, liftPositionTo3D(node.position_m));
  }

  return positions;
}

function gnssOffsetByAgent(sceneTrace: SceneTrace): Map<string, Position3D> {
  const truthPositions = nominalTruthPositions(sceneTrace);
  const offsets = new Map<string, Position3D>();

  for (const measurement of sceneTrace.measurements.gnss) {
    const truthPosition = truthPositions.get(measurement.agent_id);
    if (!truthPosition) {
      continue;
    }

    const gnssPosition = liftPositionTo3D(measurement.position_m);
    offsets.set(measurement.agent_id, [
      gnssPosition[0] - truthPosition[0],
      gnssPosition[1] - truthPosition[1],
      gnssPosition[2] - truthPosition[2]
    ]);
  }

  return offsets;
}

function stableUnit(agentId: string,
                    salt: number): number {
  const key = `${salt}:${agentId}`;
  let hash = (FNV_OFFSET_BASIS ^ salt) >>> 0;
  for (const char of key) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }

  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822519) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489917) >>> 0;
  hash ^= hash >>> 16;

  const unitValue = (hash >>> 0) / UINT32_MAX;
  return unitValue;
}

function fallbackGnssOffset(agentId: string,
                            sigmaM: number): Position3D {
  const safeSigmaM = Math.max(0.25, sigmaM);
  const angle = stableUnit(agentId, 131) * Math.PI * 2;
  const radiusM = safeSigmaM * (0.28 + stableUnit(agentId, 149) * 0.16);
  const offset: Position3D = [
    Math.cos(angle) * radiusM,
    0,
    Math.sin(angle) * radiusM
  ];
  return offset;
}

function defaultGnssSigma(sceneTrace: SceneTrace): number {
  const sigmaValues = sceneTrace.measurements.gnss
    .map((measurement) => measurement.sigma_m)
    .filter((sigmaM) => Number.isFinite(sigmaM) && sigmaM > 0)
    .sort((firstSigma, secondSigma) => firstSigma - secondSigma);
  if (sigmaValues.length === 0) {
    return 1.0;
  }

  const middleIndex = Math.floor(sigmaValues.length / 2);
  const sigmaM = sigmaValues[middleIndex];
  return sigmaM;
}

export function buildLiveEstimationFrame(sceneTrace: SceneTrace,
                                         timeSeconds: number,
                                         maxUwbLinksPerAgent: number,
                                         motionAmplitudeM: number,
                                         _missionAction: MissionActionState | null = null,
                                         selectionOverrides: LiveUwbSelectionOverrides = {},
                                         previousSelectedLinks: SelectedLiveUwbLink[] = [],
                                         suppliedMissionPositions: Map<string, Position3D> | null = null): LiveEstimationFrame {
  const nominalTruth = nominalTruthPositions(sceneTrace);
  const gnssOffsets = gnssOffsetByAgent(sceneTrace);
  const truthPositions = new Map<string, Position3D>();
  const gnssPositions = new Map<string, Position3D>();
  const gnssSigma = new Map<string, number>();
  const actionTruthPositions = suppliedMissionPositions;
  const activeTruthEntries = actionTruthPositions ?? nominalTruth;
  const fallbackSigmaM = defaultGnssSigma(sceneTrace);

  for (const [agentId, activePosition] of activeTruthEntries.entries()) {
    const nominalPosition = nominalTruth.get(agentId) ?? activePosition;
    const truthPosition = actionTruthPositions?.get(agentId) ?? animatedSwarmPosition(
      agentId,
      nominalPosition,
      timeSeconds,
      motionAmplitudeM
    );
    truthPositions.set(agentId, truthPosition);

    const gnssOffset = gnssOffsets.get(agentId)
      ?? fallbackGnssOffset(agentId, fallbackSigmaM);
    gnssPositions.set(agentId, [
      truthPosition[0] + gnssOffset[0],
      truthPosition[1] + gnssOffset[1],
      truthPosition[2] + gnssOffset[2]
    ]);
  }

  for (const measurement of sceneTrace.measurements.gnss) {
    gnssSigma.set(measurement.agent_id, measurement.sigma_m);
  }
  for (const agentId of truthPositions.keys()) {
    if (!gnssSigma.has(agentId)) {
      gnssSigma.set(agentId, fallbackSigmaM);
    }
  }

  const candidateMeasurements = liveUwbCandidates(sceneTrace, truthPositions);
  const maxRangeM = selectionOverrides.maxRangeM ?? DEFAULT_LIVE_UWB_RANGE_M;
  const addRangeM = selectionOverrides.addRangeM ?? maxRangeM;
  const dropRangeM = selectionOverrides.dropRangeM ?? maxRangeM * 1.1;
  const selection = selectLiveUwbLinks({
    positions: truthPositions,
    measurements: candidateMeasurements,
    previousSelectedLinks,
    options: {
      maxLinksPerAgent: maxUwbLinksPerAgent,
      maxRangeM,
      addRangeM,
      dropRangeM,
      preferNearby: true,
      preferUnderconnectedAgents: true,
      preferTriangleClosure: true,
      maxGraphChangesPerFrame: selectionOverrides.maxGraphChangesPerFrame ?? 2
    }
  });
  const uwbLinks = selection.selectedLinks.map((link) => ({
    sourceId: link.sourceId,
    targetId: link.targetId,
    measuredDistanceM: link.measuredDistanceM,
    sigmaM: link.sigmaM,
    selectionReason: link.selectionReason
  }));

  const liveFrame = {
    truthPositions,
    gnssPositions,
    gnssSigma,
    uwbLinks,
    uwbSelection: selection.diagnostics
  };
  return liveFrame;
}

export function solveLiveFusion(frame: LiveEstimationFrame): Map<string, Position3D> {
  const fusedPositions = new Map<string, Position3D>();
  for (const [agentId, gnssPosition] of frame.gnssPositions.entries()) {
    fusedPositions.set(agentId, [...gnssPosition]);
  }

  for (let iteration = 0; iteration < 12; iteration += 1) {
    for (const link of frame.uwbLinks) {
      const sourcePosition = fusedPositions.get(link.sourceId);
      const targetPosition = fusedPositions.get(link.targetId);
      if (!sourcePosition || !targetPosition) {
        continue;
      }

      const dx = targetPosition[0] - sourcePosition[0];
      const dy = targetPosition[1] - sourcePosition[1];
      const dz = targetPosition[2] - sourcePosition[2];
      const currentDistance = Math.max(Math.hypot(dx, dy, dz), 1e-9);
      const residual = currentDistance - link.measuredDistanceM;
      const correctionScale = residual * 0.18 / currentDistance;
      const correction: Position3D = [
        dx * correctionScale,
        dy * correctionScale,
        dz * correctionScale
      ];

      sourcePosition[0] += correction[0];
      sourcePosition[1] += correction[1];
      sourcePosition[2] += correction[2];
      targetPosition[0] -= correction[0];
      targetPosition[1] -= correction[1];
      targetPosition[2] -= correction[2];
    }

    for (const [agentId, gnssPosition] of frame.gnssPositions.entries()) {
      const fusedPosition = fusedPositions.get(agentId);
      if (!fusedPosition) {
        continue;
      }

      fusedPosition[0] += (gnssPosition[0] - fusedPosition[0]) * 0.08;
      fusedPosition[1] += (gnssPosition[1] - fusedPosition[1]) * 0.08;
      fusedPosition[2] += (gnssPosition[2] - fusedPosition[2]) * 0.08;
    }
  }

  return fusedPositions;
}
