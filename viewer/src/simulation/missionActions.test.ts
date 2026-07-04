import { describe, expect, it } from "vitest";

import * as missionActions from "./missionActions";
import {
  defaultMissionActionState,
  normalizeMissionActionState
} from "./missionActions";

describe("mission action intent state", () => {
  it("provides viewer intent defaults without solver evidence fields", () => {
    const actionState = defaultMissionActionState();
    const actionRecord = actionState as unknown as Record<string, unknown>;

    expect(actionState.formation).toBe("grid");
    expect(actionState.motion).toBe("random_walk");
    expect(actionState.speedMps).toBe(1);
    expect(actionState.randomWalkAmplitudeM).toBe(0.24);
    expect(actionState.path).toBe("loop");
    expect(actionRecord.truth_for_solver).toBeUndefined();
    expect(actionRecord.formation_answer).toBeUndefined();
    expect(actionRecord.future_path).toBeUndefined();
  });

  it("normalizes numeric intent controls without creating positions", () => {
    const normalizedState = normalizeMissionActionState({
      ...defaultMissionActionState(),
      speedMps: -3,
      randomWalkAmplitudeM: -4,
      transitionDurationS: 0
    });

    expect(normalizedState.speedMps).toBe(0);
    expect(normalizedState.randomWalkAmplitudeM).toBe(0);
    expect(normalizedState.transitionDurationS).toBe(0.001);
  });

  it("does not expose frontend mission geometry from the intent module", () => {
    expect("missionActionPositions" in missionActions).toBe(false);
    expect("formationOffsets" in missionActions).toBe(false);
    expect("motionCenter" in missionActions).toBe(false);
    expect("fallbackMissionActionPositions" in missionActions).toBe(false);
  });
});
