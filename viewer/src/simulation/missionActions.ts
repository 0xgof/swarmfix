import type { Position3D } from "../animation/liveMotion";

export type FormationMode = "grid" | "line" | "column" | "wedge" | "ring" | "random_cloud";
export type MotionMode = "static" | "random_walk" | "forward" | "path_follow";
export type PathMode = "loop" | "waypoints";

export interface MissionActionState {
  formation: FormationMode;
  motion: MotionMode;
  speedMps: number;
  randomWalkAmplitudeM: number;
  path: PathMode;
  previousFormation: FormationMode | null;
  transitionStartedAtS: number | null;
  transitionDurationS: number;
}

const DEFAULT_SPACING_M = 3.0;
const DEFAULT_PATH_RADIUS_M = 8.0;
const DEFAULT_PATH_PERIOD_S = 18.0;

function stableUnit(agentId: string,
                    salt: number): number {
  let hash = salt;
  for (const char of agentId) {
    hash = (hash * 41 + char.charCodeAt(0) + salt) % 100000;
  }

  const unitValue = hash / 100000;
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

export function defaultMissionActionState(): MissionActionState {
  const state: MissionActionState = {
    formation: "grid",
    motion: "random_walk",
    speedMps: 1.0,
    randomWalkAmplitudeM: 0.24,
    path: "loop",
    previousFormation: null,
    transitionStartedAtS: null,
    transitionDurationS: 2.0
  };
  return state;
}

export function normalizeMissionActionState(state: MissionActionState): MissionActionState {
  const normalizedState: MissionActionState = {
    ...state,
    speedMps: Math.max(0, state.speedMps),
    randomWalkAmplitudeM: Math.max(0, state.randomWalkAmplitudeM),
    transitionDurationS: Math.max(0.001, state.transitionDurationS)
  };
  return normalizedState;
}

export function formationOffsets(agentIds: string[],
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
    } else if (formation === "random_cloud") {
      offset = randomCloudOffset(agentId);
    } else {
      offset = gridOffset(index, count);
    }
    offsets.set(agentId, offset);
  });

  return offsets;
}

export function motionCenter(state: MissionActionState,
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

export function missionActionPositions(agentIds: string[],
                                       state: MissionActionState,
                                       timeSeconds: number): Map<string, Position3D> {
  const safeState = normalizeMissionActionState(state);
  const currentOffsets = formationOffsets(agentIds, safeState.formation);
  const previousOffsets = safeState.previousFormation
    ? formationOffsets(agentIds, safeState.previousFormation)
    : null;
  const center = motionCenter(safeState, timeSeconds);
  const transitionStart = safeState.transitionStartedAtS;
  const transitionProgress = (
    previousOffsets && transitionStart !== null
      ? (timeSeconds - transitionStart) / safeState.transitionDurationS
      : 1
  );
  const positions = new Map<string, Position3D>();

  for (const agentId of agentIds) {
    const currentOffset = currentOffsets.get(agentId) ?? [0, 0, 0];
    const previousOffset = previousOffsets?.get(agentId) ?? currentOffset;
    const formationOffset = interpolatePosition(
      previousOffset,
      currentOffset,
      transitionProgress
    );
    const driftOffset = safeState.motion === "random_walk"
      ? randomWalkOffset(agentId, timeSeconds, safeState.randomWalkAmplitudeM)
      : [0, 0, 0] as Position3D;
    const position = addPosition(addPosition(center, formationOffset), driftOffset);
    positions.set(agentId, position);
  }

  return positions;
}
