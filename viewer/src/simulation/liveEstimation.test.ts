import { describe, expect, it } from "vitest";

import type { SceneTrace } from "../data/sceneTypes";
import {
  buildLiveEstimationFrame,
  solveLiveFusion
} from "./liveEstimation";

const sceneTrace: SceneTrace = {
  schema_version: "0.1.0",
  metadata: { scenario: "live_estimation", units: "m", dimension: 2 },
  truth: {
    nodes: [
      { id: "agent_0", position_m: [0, 0] },
      { id: "agent_1", position_m: [2, 0] },
      { id: "agent_2", position_m: [0, 2] }
    ]
  },
  measurements: {
    gnss: [
      {
        agent_id: "agent_0",
        position_m: [0.2, 0.1],
        sigma_m: 1,
        uncertainty: { type: "circle", radius_m: 1 }
      },
      {
        agent_id: "agent_1",
        position_m: [2.4, 0.1],
        sigma_m: 1,
        uncertainty: { type: "circle", radius_m: 1 }
      },
      {
        agent_id: "agent_2",
        position_m: [-0.1, 2.25],
        sigma_m: 1,
        uncertainty: { type: "circle", radius_m: 1 }
      }
    ],
    uwb: [
      {
        source_id: "agent_0",
        target_id: "agent_1",
        measured_distance_m: 2,
        sigma_m: 0.1,
        true_distance_m: 2
      },
      {
        source_id: "agent_0",
        target_id: "agent_2",
        measured_distance_m: 2,
        sigma_m: 0.1,
        true_distance_m: 2
      },
      {
        source_id: "agent_1",
        target_id: "agent_2",
        measured_distance_m: Math.SQRT2 * 2,
        sigma_m: 0.1,
        true_distance_m: Math.SQRT2 * 2
      }
    ],
    references: []
  },
  estimates: {},
  metrics: {},
  trace: {
    trace_type: "residual_evaluation",
    iterations: [{
      iteration: 0,
      positions: {
        agent_0: [0.2, 0.1],
        agent_1: [2.2, 0.1],
        agent_2: [0.2, 2.1]
      },
      cost: { total: 0, gnss: 0, uwb: 0, reference: 0 },
      residuals: { gnss: [], uwb: [], reference: [] }
    }]
  }
};

describe("live estimation frame", () => {
  it("moves truth and derives GNSS from the moved truth plus original GNSS error", () => {
    const frameAtStart = buildLiveEstimationFrame(sceneTrace, 0, 3, 0.3);
    const laterFrame = buildLiveEstimationFrame(sceneTrace, 1.5, 3, 0.3);
    const startTruth = frameAtStart.truthPositions.get("agent_0");
    const laterTruth = laterFrame.truthPositions.get("agent_0");
    const laterGnss = laterFrame.gnssPositions.get("agent_0");

    expect(laterTruth).not.toEqual(startTruth);
    expect(laterGnss?.[0]).toBeCloseTo((laterTruth?.[0] ?? 0) + 0.2);
    expect(laterGnss?.[2]).toBeCloseTo((laterTruth?.[2] ?? 0) + 0.1);
  });

  it("updates UWB measured distances when the live swarm shape changes", () => {
    const frameAtStart = buildLiveEstimationFrame(sceneTrace, 0, 3, 0.3);
    const laterFrame = buildLiveEstimationFrame(sceneTrace, 8.0, 3, 0.3);
    const distanceDelta = Math.abs(
      laterFrame.uwbLinks[0].measuredDistanceM
      - frameAtStart.uwbLinks[0].measuredDistanceM
    );

    expect(distanceDelta).toBeGreaterThan(0.005);
  });

  it("recalculates fused positions from live GNSS and selected UWB links", () => {
    const sparseFrame = buildLiveEstimationFrame(sceneTrace, 1.0, 1, 0.3);
    const denseFrame = buildLiveEstimationFrame(sceneTrace, 1.0, 3, 0.3);
    const sparseFused = solveLiveFusion(sparseFrame).get("agent_1");
    const denseFused = solveLiveFusion(denseFrame).get("agent_1");

    expect(sparseFused).toBeDefined();
    expect(denseFused).toBeDefined();
    expect(denseFused).not.toEqual(sparseFused);
  });
});
