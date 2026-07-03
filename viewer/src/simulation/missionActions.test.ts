import { describe, expect, it } from "vitest";

import {
  defaultMissionActionState,
  formationOffsets,
  missionActionPositions,
  motionCenter,
  type MissionActionState
} from "./missionActions";

const agentIds = ["agent_0", "agent_1", "agent_2", "agent_3", "agent_4"];

function offsetDistance(a: [number, number, number],
                        b: [number, number, number]): number {
  const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  return distance;
}

describe("mission action formation model", () => {
  it("generates stable offsets for every formation mode", () => {
    const formations: MissionActionState["formation"][] = [
      "grid",
      "line",
      "column",
      "wedge",
      "ring",
      "random_cloud"
    ];

    for (const formation of formations) {
      const firstOffsets = formationOffsets(agentIds, formation);
      const repeatedOffsets = formationOffsets(agentIds, formation);

      expect([...firstOffsets.keys()]).toEqual(agentIds);
      expect(firstOffsets).toEqual(repeatedOffsets);
      for (const offset of firstOffsets.values()) {
        expect(offset.every(Number.isFinite)).toBe(true);
      }
    }
  });

  it("keeps static center fixed and moves forward by speed over time", () => {
    const staticState = { ...defaultMissionActionState(), motion: "static" as const };
    const forwardState = {
      ...defaultMissionActionState(),
      motion: "forward" as const,
      speedMps: 2
    };

    expect(motionCenter(staticState, 0)).toEqual(motionCenter(staticState, 20));
    expect(motionCenter(forwardState, 3)).toEqual([6, 0, 0]);
  });

  it("returns repeatable bounded random-walk positions", () => {
    const state = {
      ...defaultMissionActionState(),
      motion: "random_walk" as const,
      randomWalkAmplitudeM: 0.4
    };
    const positions = missionActionPositions(agentIds, state, 4.5);
    const repeatedPositions = missionActionPositions(agentIds, state, 4.5);
    const baseOffsets = formationOffsets(agentIds, state.formation);

    expect(positions).toEqual(repeatedPositions);
    for (const agentId of agentIds) {
      const position = positions.get(agentId)!;
      const offset = baseOffsets.get(agentId)!;
      expect(offsetDistance(position, offset)).toBeLessThanOrEqual(0.75);
    }
  });

  it("follows a repeatable path around a loop", () => {
    const state = { ...defaultMissionActionState(), motion: "path_follow" as const };

    expect(motionCenter(state, 2)).toEqual(motionCenter(state, 2));
    expect(motionCenter(state, 0)).not.toEqual(motionCenter(state, 4));
  });

  it("interpolates between previous and target formation offsets", () => {
    const state: MissionActionState = {
      ...defaultMissionActionState(),
      formation: "line",
      motion: "static",
      previousFormation: "grid",
      transitionStartedAtS: 10,
      transitionDurationS: 4
    };
    const startPositions = missionActionPositions(agentIds, state, 10);
    const midPositions = missionActionPositions(agentIds, state, 12);
    const finalPositions = missionActionPositions(agentIds, state, 14);
    const gridOffsets = formationOffsets(agentIds, "grid");
    const lineOffsets = formationOffsets(agentIds, "line");

    expect(startPositions.get("agent_4")).toEqual(gridOffsets.get("agent_4"));
    expect(finalPositions.get("agent_4")).toEqual(lineOffsets.get("agent_4"));
    expect(midPositions.get("agent_4")).not.toEqual(gridOffsets.get("agent_4"));
    expect(midPositions.get("agent_4")).not.toEqual(lineOffsets.get("agent_4"));
  });

  it("keeps mission action state free of solver evidence fields", () => {
    const actionState = defaultMissionActionState() as unknown as Record<string, unknown>;

    expect(actionState.truth_for_solver).toBeUndefined();
    expect(actionState.formation_answer).toBeUndefined();
    expect(actionState.future_path).toBeUndefined();
  });
});
