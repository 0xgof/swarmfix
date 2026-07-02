import { describe, expect, it } from "vitest";

import type { SceneTrace } from "../data/sceneTypes";
import { createViewerState } from "./ViewerState";
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
    viewerState.setIteration(99);
    expect(viewerState.selectedIteration).toBe(2);
    viewerState.setIteration(-4);
    expect(viewerState.selectedIteration).toBe(0);
  });

  it("tracks max selected UWB links per drone rather than a global link count", () => {
    const viewerState = createViewerState(sceneWithIterations(1));

    expect(viewerState.maxUwbLinksPerAgent).toBe(1);
    viewerState.setMaxUwbLinksPerAgent(99);
    expect(viewerState.maxUwbLinksPerAgent).toBe(1);
    viewerState.setMaxUwbLinksPerAgent(-5);
    expect(viewerState.maxUwbLinksPerAgent).toBe(0);
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
