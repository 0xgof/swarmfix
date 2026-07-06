import { describe, expect, it } from "vitest";

import {
  defaultMissionActionState,
  type MissionActionState
} from "./missionActions";
import {
  fallbackFormationOffsets,
  fallbackMissionActionPositions,
  fallbackMotionCenter
} from "./missionActionFallback";

const agentIds = ["agent_0", "agent_1", "agent_2", "agent_3", "agent_4"];

function offsetDistance(a: [number, number, number],
                        b: [number, number, number]): number {
  const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  return distance;
}

describe("explicit fallback mission action geometry", () => {
  it("generates stable fallback offsets for every formation mode", () => {
    const formations: MissionActionState["formation"][] = [
      "grid",
      "line",
      "column",
      "wedge",
      "ring",
      "square_patrol",
      "random_cloud"
    ];

    for (const formation of formations) {
      const firstOffsets = fallbackFormationOffsets(agentIds, formation);
      const repeatedOffsets = fallbackFormationOffsets(agentIds, formation);

      expect([...firstOffsets.keys()]).toEqual(agentIds);
      expect(firstOffsets).toEqual(repeatedOffsets);
      for (const offset of firstOffsets.values()) {
        expect(offset.every(Number.isFinite)).toBe(true);
      }
    }
  });

  it("keeps fallback static center fixed and moves forward by speed over time", () => {
    const staticState = { ...defaultMissionActionState(), motion: "static" as const };
    const forwardState = {
      ...defaultMissionActionState(),
      motion: "forward" as const,
      speedMps: 2
    };

    expect(fallbackMotionCenter(staticState, 0)).toEqual(
      fallbackMotionCenter(staticState, 20)
    );
    expect(fallbackMotionCenter(forwardState, 3)).toEqual([6, 0, 0]);
  });

  it("returns repeatable bounded fallback random-walk positions", () => {
    const state = {
      ...defaultMissionActionState(),
      motion: "random_walk" as const,
      randomWalkAmplitudeM: 0.4
    };
    const positions = fallbackMissionActionPositions(agentIds, state, 4.5);
    const repeatedPositions = fallbackMissionActionPositions(agentIds, state, 4.5);
    const baseOffsets = fallbackFormationOffsets(agentIds, state.formation);

    expect(positions).toEqual(repeatedPositions);
    for (const agentId of agentIds) {
      const position = positions.get(agentId)!;
      const offset = baseOffsets.get(agentId)!;
      expect(offsetDistance(position, offset)).toBeLessThanOrEqual(0.75);
    }
  });

  it("keeps square-patrol corners fixed while interior agents random-walk inside", () => {
    const state: MissionActionState = {
      ...defaultMissionActionState(),
      formation: "square_patrol",
      motion: "random_walk",
      randomWalkAmplitudeM: 1
    };

    const startPositions = fallbackMissionActionPositions(agentIds, state, 1);
    const laterPositions = fallbackMissionActionPositions(agentIds, state, 2);

    expect(startPositions.get("agent_0")).toEqual([-3, 0, -3]);
    expect(startPositions.get("agent_1")).toEqual([3, 0, -3]);
    expect(startPositions.get("agent_2")).toEqual([3, 0, 3]);
    expect(startPositions.get("agent_3")).toEqual([-3, 0, 3]);
    for (const agentId of agentIds.slice(0, 4)) {
      expect(laterPositions.get(agentId)).toEqual(startPositions.get(agentId));
    }
    expect(laterPositions.get("agent_4")).not.toEqual(startPositions.get("agent_4"));
    expect(Math.abs(laterPositions.get("agent_4")![0])).toBeLessThanOrEqual(3);
    expect(Math.abs(laterPositions.get("agent_4")![2])).toBeLessThanOrEqual(3);
  });

  it("gives fallback random-walk motion agent-specific temporal drift", () => {
    const state = {
      ...defaultMissionActionState(),
      motion: "random_walk" as const,
      randomWalkAmplitudeM: 1
    };
    const startPositions = fallbackMissionActionPositions(agentIds, state, 1);
    const laterPositions = fallbackMissionActionPositions(agentIds, state, 2);
    const motionDeltas = new Set(agentIds.map((agentId) => {
      const start = startPositions.get(agentId)!;
      const later = laterPositions.get(agentId)!;
      return [
        (later[0] - start[0]).toFixed(2),
        (later[1] - start[1]).toFixed(2),
        (later[2] - start[2]).toFixed(2)
      ].join(",");
    }));
    const displacementM = agentIds.map((agentId) => (
      offsetDistance(laterPositions.get(agentId)!, startPositions.get(agentId)!)
    ));

    expect(motionDeltas.size).toBeGreaterThan(1);
    expect(Math.max(...displacementM)).toBeGreaterThan(0.2);
  });

  it("follows a repeatable fallback path around a loop", () => {
    const state = { ...defaultMissionActionState(), motion: "path_follow" as const };

    expect(fallbackMotionCenter(state, 2)).toEqual(fallbackMotionCenter(state, 2));
    expect(fallbackMotionCenter(state, 0)).not.toEqual(fallbackMotionCenter(state, 4));
  });

  it("interpolates between previous and target fallback formation offsets", () => {
    const state: MissionActionState = {
      ...defaultMissionActionState(),
      formation: "line",
      motion: "static",
      previousFormation: "grid",
      transitionStartedAtS: 10,
      transitionDurationS: 4
    };
    const startPositions = fallbackMissionActionPositions(agentIds, state, 10);
    const midPositions = fallbackMissionActionPositions(agentIds, state, 12);
    const finalPositions = fallbackMissionActionPositions(agentIds, state, 14);
    const gridOffsets = fallbackFormationOffsets(agentIds, "grid");
    const lineOffsets = fallbackFormationOffsets(agentIds, "line");

    expect(startPositions.get("agent_4")).toEqual(gridOffsets.get("agent_4"));
    expect(finalPositions.get("agent_4")).toEqual(lineOffsets.get("agent_4"));
    expect(midPositions.get("agent_4")).not.toEqual(gridOffsets.get("agent_4"));
    expect(midPositions.get("agent_4")).not.toEqual(lineOffsets.get("agent_4"));
  });
});
