import type { Position3D } from "../animation/liveMotion";
import {
  normalizeMissionActionState,
  type FormationMode,
  type MissionActionState
} from "./missionActions";

const DEFAULT_SPACING_M = 3.0;
const DEFAULT_PATH_RADIUS_M = 8.0;
const DEFAULT_PATH_PERIOD_S = 18.0;
const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;
const UINT32_MAX = 0xffffffff;

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

function orderedAgentIds(agentIds: string[]): string[] {
  const orderedIds = [...agentIds].sort((firstId, secondId) => (
    firstId.localeCompare(secondId, undefined, { numeric: true })
  ));
  return orderedIds;
}

function centeredIndex(index: number,
                       count: number): number {
  const centered = index - (count - 1) / 2;
  return centered;
}

function gridOffset(index: number,
                    count: number): Position3D {
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const column = index % columns;
  const row = Math.floor(index / columns);
  const x = (column - (columns - 1) / 2) * DEFAULT_SPACING_M;
  const z = (row - (rows - 1) / 2) * DEFAULT_SPACING_M;
  const offset: Position3D = [x, 0, z];
  return offset;
}

function lineOffset(index: number,
                    count: number): Position3D {
  const offset: Position3D = [centeredIndex(index, count) * DEFAULT_SPACING_M, 0, 0];
  return offset;
}

function columnOffset(index: number,
                      count: number): Position3D {
  const offset: Position3D = [0, 0, centeredIndex(index, count) * DEFAULT_SPACING_M];
  return offset;
}

function wedgeOffset(index: number): Position3D {
  if (index === 0) {
    return [0, 0, 0];
  }

  const rank = Math.ceil(index / 2);
  const side = index % 2 === 0 ? 1 : -1;
  const offset: Position3D = [
    side * rank * DEFAULT_SPACING_M,
    0,
    -rank * DEFAULT_SPACING_M
  ];
  return offset;
}

function ringOffset(index: number,
                    count: number): Position3D {
  const radius = Math.max(DEFAULT_SPACING_M, count * DEFAULT_SPACING_M / (Math.PI * 2));
  const angle = (Math.PI * 2 * index) / Math.max(1, count);
  const offset: Position3D = [
    Math.cos(angle) * radius,
    0,
    Math.sin(angle) * radius
  ];
  return offset;
}

function randomCloudOffset(agentId: string): Position3D {
  const radius = DEFAULT_SPACING_M * (0.8 + stableUnit(agentId, 17) * 1.6);
  const angle = stableUnit(agentId, 29) * Math.PI * 2;
  const height = (stableUnit(agentId, 43) - 0.5) * DEFAULT_SPACING_M * 0.35;
  const offset: Position3D = [
    Math.cos(angle) * radius,
    height,
    Math.sin(angle) * radius
  ];
  return offset;
}

function squarePatrolOffset(agentId: string,
                            index: number,
                            count: number): Position3D {
  if (count < 5) {
    throw new Error("square_patrol formation requires at least 5 agents");
  }

  const squareCorners: Position3D[] = [
    [-DEFAULT_SPACING_M, 0, -DEFAULT_SPACING_M],
    [DEFAULT_SPACING_M, 0, -DEFAULT_SPACING_M],
    [DEFAULT_SPACING_M, 0, DEFAULT_SPACING_M],
    [-DEFAULT_SPACING_M, 0, DEFAULT_SPACING_M]
  ];
  if (index < squareCorners.length) {
    return squareCorners[index];
  }

  const interiorScale = DEFAULT_SPACING_M * 0.55;
  const offset: Position3D = [
    (stableUnit(agentId, 97) - 0.5) * interiorScale * 2,
    (stableUnit(agentId, 113) - 0.5) * DEFAULT_SPACING_M * 0.2,
    (stableUnit(agentId, 109) - 0.5) * interiorScale * 2
  ];
  return offset;
}

function addPosition(a: Position3D,
                     b: Position3D): Position3D {
  const position: Position3D = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  return position;
}

function interpolatePosition(a: Position3D,
                             b: Position3D,
                             progress: number): Position3D {
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const position: Position3D = [
    a[0] + (b[0] - a[0]) * clampedProgress,
    a[1] + (b[1] - a[1]) * clampedProgress,
    a[2] + (b[2] - a[2]) * clampedProgress
  ];
  return position;
}

function randomWalkOffset(agentId: string,
                          timeSeconds: number,
                          amplitudeM: number): Position3D {
  const safeAmplitude = Math.max(0, amplitudeM);
  const phase = stableUnit(agentId, 71) * Math.PI * 2;
  const x = Math.sin(timeSeconds * 0.55 + phase) * safeAmplitude;
  const y = Math.sin(timeSeconds * 0.41 + phase * 1.7) * safeAmplitude * 0.25;
  const z = Math.cos(timeSeconds * 0.49 + phase * 1.3) * safeAmplitude;
  const offset: Position3D = [x, y, z];
  return offset;
}

function squarePatrolRandomWalkOffset(agentId: string,
                                      formationOffset: Position3D,
                                      timeSeconds: number,
                                      amplitudeM: number): Position3D {
  const rawDrift = randomWalkOffset(agentId, timeSeconds, amplitudeM);
  const candidateX = Math.min(
    DEFAULT_SPACING_M,
    Math.max(-DEFAULT_SPACING_M, formationOffset[0] + rawDrift[0])
  );
  const candidateZ = Math.min(
    DEFAULT_SPACING_M,
    Math.max(-DEFAULT_SPACING_M, formationOffset[2] + rawDrift[2])
  );
  const drift: Position3D = [
    candidateX - formationOffset[0],
    rawDrift[1],
    candidateZ - formationOffset[2]
  ];
  return drift;
}

export function fallbackFormationOffsets(agentIds: string[],
                                         formation: FormationMode): Map<string, Position3D> {
  const orderedIds = orderedAgentIds(agentIds);
  const offsets = new Map<string, Position3D>();
  const count = orderedIds.length;

  orderedIds.forEach((agentId, index) => {
    let offset: Position3D;
    if (formation === "line") {
      offset = lineOffset(index, count);
    } else if (formation === "column") {
      offset = columnOffset(index, count);
    } else if (formation === "wedge") {
      offset = wedgeOffset(index);
    } else if (formation === "ring") {
      offset = ringOffset(index, count);
    } else if (formation === "square_patrol") {
      offset = squarePatrolOffset(agentId, index, count);
    } else if (formation === "random_cloud") {
      offset = randomCloudOffset(agentId);
    } else {
      offset = gridOffset(index, count);
    }
    offsets.set(agentId, offset);
  });

  return offsets;
}

export function fallbackMotionCenter(state: MissionActionState,
                                     timeSeconds: number): Position3D {
  const safeState = normalizeMissionActionState(state);
  if (safeState.motion === "forward") {
    return [safeState.speedMps * timeSeconds, 0, 0];
  }

  if (safeState.motion === "path_follow") {
    const progress = (timeSeconds % DEFAULT_PATH_PERIOD_S) / DEFAULT_PATH_PERIOD_S;
    const angle = progress * Math.PI * 2;
    return [
      Math.cos(angle) * DEFAULT_PATH_RADIUS_M,
      0,
      Math.sin(angle) * DEFAULT_PATH_RADIUS_M
    ];
  }

  return [0, 0, 0];
}

export function fallbackMissionActionPositions(agentIds: string[],
                                               state: MissionActionState,
                                               timeSeconds: number): Map<string, Position3D> {
  const safeState = normalizeMissionActionState(state);
  const currentOffsets = fallbackFormationOffsets(agentIds, safeState.formation);
  const previousOffsets = safeState.previousFormation
    ? fallbackFormationOffsets(agentIds, safeState.previousFormation)
    : null;
  const center = fallbackMotionCenter(safeState, timeSeconds);
  const transitionStart = safeState.transitionStartedAtS;
  const transitionProgress = (
    previousOffsets && transitionStart !== null
      ? (timeSeconds - transitionStart) / safeState.transitionDurationS
      : 1
  );
  const positions = new Map<string, Position3D>();
  const orderedIds = orderedAgentIds(agentIds);
  const squarePatrolCorners = new Set(
    safeState.formation === "square_patrol" ? orderedIds.slice(0, 4) : []
  );

  for (const agentId of agentIds) {
    const currentOffset = currentOffsets.get(agentId) ?? [0, 0, 0];
    const previousOffset = previousOffsets?.get(agentId) ?? currentOffset;
    const formationOffset = interpolatePosition(
      previousOffset,
      currentOffset,
      transitionProgress
    );
    let driftOffset: Position3D = [0, 0, 0];
    if (safeState.motion === "random_walk") {
      if (squarePatrolCorners.has(agentId)) {
        driftOffset = [0, 0, 0];
      } else if (safeState.formation === "square_patrol") {
        driftOffset = squarePatrolRandomWalkOffset(
          agentId,
          formationOffset,
          timeSeconds,
          safeState.randomWalkAmplitudeM
        );
      } else {
        driftOffset = randomWalkOffset(agentId, timeSeconds, safeState.randomWalkAmplitudeM);
      }
    }
    const position = addPosition(addPosition(center, formationOffset), driftOffset);
    positions.set(agentId, position);
  }

  return positions;
}
