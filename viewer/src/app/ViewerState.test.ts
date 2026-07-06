import { describe, expect, it } from "vitest";

import type { SceneTrace } from "../data/sceneTypes";
import {
  createMissionAgentIds,
  createViewerState,
  maxUwbLinksForDroneCount,
  maxUwbLinksPerAgentLimit
} from "./ViewerState";
import { PlaybackController } from "./PlaybackController";

function sceneWithIterations(iterations: number): SceneTrace {
  const traceIterations = Array.from({ length: iterations }, (_, index) => ({
    iteration: index,
    positions: { agent_0: [index, index + 1] },
    cost: { total: index + 1, gnss: index + 1, uwb: 0, reference: 0 },
    residuals: { gnss: [], uwb: [], reference: [] }
  }));

  return {
    schema_version: "0.1.0",
    metadata: { scenario: "state_scene", units: "m", dimension: 2 },
    truth: { nodes: [{ id: "agent_0", position_m: [0, 0] }] },
    measurements: {
      gnss: [],
      uwb: [
        {
          source_id: "agent_0",
          target_id: "agent_1",
          measured_distance_m: 1,
          sigma_m: 0.1,
          true_distance_m: 1
        }
      ],
      references: []
    },
    estimates: {},
    metrics: {},
    trace: { trace_type: "residual_evaluation", iterations: traceIterations }
  };
}

describe("viewer state and playback", () => {
  it("creates default layer visibility and clamps selected iterations", () => {
    const viewerState = createViewerState(sceneWithIterations(3));

    expect(viewerState.layers.uwbLinks).toBe(true);
    expect(viewerState.layers.positionError).toBe(true);
    expect(viewerState.layers.gnssOnly).toBe(false);
    expect(viewerState.layers.cost).toBe(false);
    viewerState.setLayerVisible("positionError", false);
    expect(viewerState.layers.positionError).toBe(false);
    viewerState.setIteration(99);
    expect(viewerState.selectedIteration).toBe(2);
    viewerState.setIteration(-4);
    expect(viewerState.selectedIteration).toBe(0);
  });

  it("clamps the per-drone link cap to the active mission drone count", () => {
    const viewerState = createViewerState(sceneWithIterations(1));

    expect(viewerState.maxUwbLinksPerAgent).toBe(0);
    viewerState.setMaxUwbLinksPerAgent(12);
    expect(viewerState.maxUwbLinksPerAgent).toBe(0);
    viewerState.setMissionDroneCount(50);
    viewerState.setMaxUwbLinksPerAgent(99);
    expect(viewerState.maxUwbLinksPerAgent).toBe(20);
    viewerState.setMaxUwbLinksPerAgent(-5);
    expect(viewerState.maxUwbLinksPerAgent).toBe(0);
  });

  it("uses nine as the maximum per-drone link cap for a 10-agent scene", () => {
    const tenAgentScene = {
      ...sceneWithIterations(1),
      truth: {
        nodes: Array.from({ length: 10 }, (_, index) => ({
          id: `agent_${index}`,
          position_m: [index, 0]
        }))
      },
      measurements: {
        gnss: [],
        uwb: [],
        references: []
      }
    };
    const viewerState = createViewerState(tenAgentScene);

    expect(maxUwbLinksPerAgentLimit(tenAgentScene)).toBe(9);
    viewerState.setMaxUwbLinksPerAgent(12);
    expect(viewerState.maxUwbLinksPerAgent).toBe(9);
  });

  it("expands and shrinks the per-drone link cap with the mission drone count", () => {
    const viewerState = createViewerState(sceneWithIterations(1));

    viewerState.setMissionDroneCount(50);
    viewerState.setMaxUwbLinksPerAgent(50);
    expect(maxUwbLinksForDroneCount(viewerState.missionDroneCount)).toBe(20);
    expect(viewerState.maxUwbLinksPerAgent).toBe(20);

    viewerState.setMissionDroneCount(4);
    expect(maxUwbLinksForDroneCount(viewerState.missionDroneCount)).toBe(3);
    expect(viewerState.maxUwbLinksPerAgent).toBe(3);
  });

  it("stores mission action state updates", () => {
    const viewerState = createViewerState(sceneWithIterations(1));

    expect(viewerState.missionAction.formation).toBe("grid");
    viewerState.setMissionAction({
      formation: "ring",
      motion: "forward",
      speedMps: 1.5,
      randomWalkAmplitudeM: 0.6
    });

    expect(viewerState.missionAction.formation).toBe("ring");
    expect(viewerState.missionAction.previousFormation).toBe("grid");
    expect(viewerState.missionAction.motion).toBe("forward");
    expect(viewerState.missionAction.speedMps).toBe(1.5);
  });

  it("stores stable mission drone count and generated ids separately from formation", () => {
    const viewerState = createViewerState(sceneWithIterations(1));

    expect(viewerState.missionDroneCount).toBe(1);
    expect(createMissionAgentIds(viewerState.missionDroneCount)).toEqual(["agent_0"]);

    viewerState.setMissionDroneCount(4);
    viewerState.setMissionAction({ formation: "ring", motion: "forward", speedMps: 1.5 });

    expect(viewerState.missionDroneCount).toBe(4);
    expect(createMissionAgentIds(viewerState.missionDroneCount)).toEqual([
      "agent_0",
      "agent_1",
      "agent_2",
      "agent_3"
    ]);
    expect(viewerState.missionAction.formation).toBe("ring");
    expect(viewerState.missionAction.motion).toBe("forward");
  });

  it("clamps mission drone count to a bounded positive menu range", () => {
    const viewerState = createViewerState(sceneWithIterations(1));

    viewerState.setMissionDroneCount(-5);
    expect(viewerState.missionDroneCount).toBe(1);

    viewerState.setMissionDroneCount(999);
    expect(viewerState.missionDroneCount).toBe(50);
  });

  it("follows the swarm barycenter by default and stores later changes", () => {
    const viewerState = createViewerState(sceneWithIterations(1));

    expect(viewerState.cameraFollowsSwarmBarycenter).toBe(true);

    viewerState.setCameraFollowsSwarmBarycenter(false);
    expect(viewerState.cameraFollowsSwarmBarycenter).toBe(false);

    viewerState.setCameraFollowsSwarmBarycenter(true);
    expect(viewerState.cameraFollowsSwarmBarycenter).toBe(true);
  });

  it("clamps mission action numeric values", () => {
    const viewerState = createViewerState(sceneWithIterations(1));

    viewerState.setMissionAction({ speedMps: -10, randomWalkAmplitudeM: -2 });

    expect(viewerState.missionAction.speedMps).toBe(0);
    expect(viewerState.missionAction.randomWalkAmplitudeM).toBe(0);
  });

  it("advances playback through exported states only", () => {
    const viewerState = createViewerState(sceneWithIterations(2));
    const playback = new PlaybackController(viewerState);

    playback.play();
    playback.stepForward();
    playback.stepForward();

    expect(viewerState.selectedIteration).toBe(1);
    expect(playback.isPlaying()).toBe(false);
  });

  it("handles single-iteration traces without moving past the only state", () => {
    const viewerState = createViewerState(sceneWithIterations(1));
    const playback = new PlaybackController(viewerState);

    playback.play();
    playback.stepForward();

    expect(viewerState.selectedIteration).toBe(0);
    expect(playback.isPlaying()).toBe(false);
  });
});
