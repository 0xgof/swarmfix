export type FormationMode = (
  "grid"
  | "line"
  | "column"
  | "wedge"
  | "ring"
  | "square_patrol"
  | "random_cloud"
);
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
