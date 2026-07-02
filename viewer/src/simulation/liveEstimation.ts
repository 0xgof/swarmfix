import {
  animatedSwarmPosition,
  liftPositionTo3D,
  selectUwbLinksByMaxDegree,
  type Position3D
} from "../animation/liveMotion";
import type { SceneTrace } from "../data/sceneTypes";

export interface LiveUwbLink {
  sourceId: string;
  targetId: string;
  measuredDistanceM: number;
  sigmaM: number;
}

export interface LiveEstimationFrame {
  truthPositions: Map<string, Position3D>;
  gnssPositions: Map<string, Position3D>;
  gnssSigma: Map<string, number>;
  uwbLinks: LiveUwbLink[];
}

function distance3D(a: Position3D,
                    b: Position3D): number {
  const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  return distance;
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

export function buildLiveEstimationFrame(sceneTrace: SceneTrace,
                                         timeSeconds: number,
                                         maxUwbLinksPerAgent: number,
                                         motionAmplitudeM: number): LiveEstimationFrame {
  const nominalTruth = nominalTruthPositions(sceneTrace);
  const gnssOffsets = gnssOffsetByAgent(sceneTrace);
  const truthPositions = new Map<string, Position3D>();
  const gnssPositions = new Map<string, Position3D>();
  const gnssSigma = new Map<string, number>();

  for (const [agentId, nominalPosition] of nominalTruth.entries()) {
    const truthPosition = animatedSwarmPosition(
      agentId,
      nominalPosition,
      timeSeconds,
      motionAmplitudeM
    );
    truthPositions.set(agentId, truthPosition);

    const gnssOffset = gnssOffsets.get(agentId) ?? [0, 0, 0];
    gnssPositions.set(agentId, [
      truthPosition[0] + gnssOffset[0],
      truthPosition[1] + gnssOffset[1],
      truthPosition[2] + gnssOffset[2]
    ]);
  }

  for (const measurement of sceneTrace.measurements.gnss) {
    gnssSigma.set(measurement.agent_id, measurement.sigma_m);
  }

  const selectedMeasurements = selectUwbLinksByMaxDegree(
    sceneTrace.measurements.uwb,
    maxUwbLinksPerAgent
  );
  const uwbLinks = selectedMeasurements.flatMap((measurement) => {
    const sourcePosition = truthPositions.get(measurement.source_id);
    const targetPosition = truthPositions.get(measurement.target_id);
    if (!sourcePosition || !targetPosition) {
      return [];
    }

    const liveLink = {
      sourceId: measurement.source_id,
      targetId: measurement.target_id,
      measuredDistanceM: distance3D(sourcePosition, targetPosition),
      sigmaM: measurement.sigma_m
    };
    return [liveLink];
  });

  const liveFrame = {
    truthPositions,
    gnssPositions,
    gnssSigma,
    uwbLinks
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
