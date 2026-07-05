import { describe, expect, it } from "vitest";

import type { SceneTrace } from "../data/sceneTypes";
import {
  buildLiveEstimationFrame,
  solveLiveFusion
} from "./liveEstimation";
import { defaultMissionActionState } from "./missionActions";
import { fallbackMissionActionPositions } from "./missionActionFallback";

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
  it("uses explicit fallback mission positions to hold static truth positions", () => {
    const actionState = {
      ...defaultMissionActionState(),
      motion: "static" as const,
      randomWalkAmplitudeM: 1
    };
    const agentIds = sceneTrace.truth.nodes.map((node) => node.id);
    const frameAtStart = buildLiveEstimationFrame(
      sceneTrace,
      0,
      3,
      0.3,
      actionState,
      {},
      [],
      fallbackMissionActionPositions(agentIds, actionState, 0)
    );
    const laterFrame = buildLiveEstimationFrame(
      sceneTrace,
      8,
      3,
      0.3,
      actionState,
      {},
      [],
      fallbackMissionActionPositions(agentIds, actionState, 8)
    );

    expect(laterFrame.truthPositions.get("agent_0")).toEqual(
      frameAtStart.truthPositions.get("agent_0")
    );
    expect(laterFrame.uwbLinks[0].measuredDistanceM).toBeCloseTo(
      frameAtStart.uwbLinks[0].measuredDistanceM
    );
  });

  it("uses explicit fallback forward positions to translate truth and measurements", () => {
    const actionState = {
      ...defaultMissionActionState(),
      motion: "forward" as const,
      speedMps: 2
    };
    const agentIds = sceneTrace.truth.nodes.map((node) => node.id);
    const frameAtStart = buildLiveEstimationFrame(
      sceneTrace,
      0,
      3,
      0.3,
      actionState,
      {},
      [],
      fallbackMissionActionPositions(agentIds, actionState, 0)
    );
    const laterFrame = buildLiveEstimationFrame(
      sceneTrace,
      3,
      3,
      0.3,
      actionState,
      {},
      [],
      fallbackMissionActionPositions(agentIds, actionState, 3)
    );

    expect(laterFrame.truthPositions.get("agent_0")?.[0]).toBeCloseTo(
      (frameAtStart.truthPositions.get("agent_0")?.[0] ?? 0) + 6
    );
    expect(laterFrame.gnssPositions.get("agent_0")?.[0]).toBeCloseTo(
      (laterFrame.truthPositions.get("agent_0")?.[0] ?? 0) + 0.2
    );
  });

  it("does not compute local mission geometry from action state implicitly", () => {
    const actionState = {
      ...defaultMissionActionState(),
      motion: "forward" as const,
      speedMps: 2
    };
    const baselineFrame = buildLiveEstimationFrame(sceneTrace, 3, 3, 0.3);
    const actionWithoutPositionsFrame = buildLiveEstimationFrame(
      sceneTrace,
      3,
      3,
      0.3,
      actionState
    );

    expect(actionWithoutPositionsFrame.truthPositions).toEqual(
      baselineFrame.truthPositions
    );
    expect(actionWithoutPositionsFrame.uwbLinks).toEqual(baselineFrame.uwbLinks);
  });

  it("uses backend mission positions when supplied and keeps GNSS offsets local", () => {
    const actionState = {
      ...defaultMissionActionState(),
      motion: "forward" as const,
      speedMps: 2
    };
    const backendPositions = new Map([
      ["agent_0", [10, 0, 5] as [number, number, number]],
      ["agent_1", [14, 0, 5] as [number, number, number]],
      ["agent_2", [10, 0, 9] as [number, number, number]]
    ]);

    const frame = buildLiveEstimationFrame(
      sceneTrace,
      3,
      3,
      0.3,
      actionState,
      {},
      [],
      backendPositions
    );

    expect(frame.truthPositions.get("agent_0")).toEqual([10, 0, 5]);
    expect(frame.gnssPositions.get("agent_0")).toEqual([10.2, 0, 5.1]);
    expect(frame.uwbLinks[0].measuredDistanceM).toBeCloseTo(4);
  });

  it("uses supplied mission positions as the active live agent set", () => {
    const backendPositions = new Map([
      ["agent_0", [10, 0, 5] as [number, number, number]],
      ["agent_1", [14, 0, 5] as [number, number, number]],
      ["agent_2", [10, 0, 9] as [number, number, number]],
      ["agent_3", [14, 0, 9] as [number, number, number]],
      ["agent_4", [12, 0, 12] as [number, number, number]]
    ]);

    const frame = buildLiveEstimationFrame(
      sceneTrace,
      3,
      4,
      0.3,
      defaultMissionActionState(),
      {},
      [],
      backendPositions
    );

    expect([...frame.truthPositions.keys()]).toEqual([
      "agent_0",
      "agent_1",
      "agent_2",
      "agent_3",
      "agent_4"
    ]);
    expect(frame.gnssPositions.get("agent_0")).toEqual([10.2, 0, 5.1]);
    expect(frame.gnssPositions.get("agent_4")).not.toEqual([12, 0, 12]);
    expect(frame.gnssSigma.get("agent_4")).toBe(1);
    expect(frame.uwbSelection.candidateLinkCount).toBe(10);
  });

  it("keeps generated GNSS markers visibly separate from generated truth", () => {
    const backendPositions = new Map([
      ["agent_4", [12, 0, 12] as [number, number, number]]
    ]);

    const frame = buildLiveEstimationFrame(
      sceneTrace,
      3,
      1,
      0.3,
      defaultMissionActionState(),
      {},
      [],
      backendPositions
    );

    expect(frame.truthPositions.get("agent_4")).toEqual([12, 0, 12]);
    expect(frame.gnssPositions.get("agent_4")).not.toEqual([12, 0, 12]);
    expect(frame.gnssSigma.get("agent_4")).toBe(1);
  });

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

  it("carries adaptive UWB selection diagnostics on the live frame", () => {
    const frame = buildLiveEstimationFrame(sceneTrace, 0, 2, 0, null, {
      maxRangeM: 2.1,
      addRangeM: 2.1,
      dropRangeM: 2.4,
      maxGraphChangesPerFrame: 10
    });

    expect(frame.uwbSelection.candidateLinkCount).toBe(2);
    expect(frame.uwbSelection.selectedLinkCount).toBe(2);
    expect(frame.uwbSelection.selectionPolicy).toBe("adaptive_range_graph_v1");
  });

  it("selects unmeasured pairs within range so live formations stay connected", () => {
    const singleMeasuredPairTrace: SceneTrace = {
      ...sceneTrace,
      truth: {
        nodes: [
          { id: "agent_0", position_m: [0, 0] },
          { id: "agent_1", position_m: [2, 0] },
          { id: "agent_2", position_m: [0, 1] }
        ]
      },
      measurements: {
        ...sceneTrace.measurements,
        uwb: [{
          source_id: "agent_0",
          target_id: "agent_1",
          measured_distance_m: 2,
          sigma_m: 0.1,
          true_distance_m: 2
        }]
      }
    };

    const frame = buildLiveEstimationFrame(singleMeasuredPairTrace, 0, 3, 0);

    expect(frame.uwbSelection.candidateLinkCount).toBe(3);
    expect(frame.uwbLinks.map((link) => `${link.sourceId}::${link.targetId}`))
      .toEqual(["agent_0::agent_1", "agent_0::agent_2", "agent_1::agent_2"]);
  });

  it("does not select a collinear skip link that would render as a doubled cord", () => {
    const collinearRowTrace: SceneTrace = {
      ...sceneTrace,
      truth: {
        nodes: [
          { id: "agent_0", position_m: [0, 0] },
          { id: "agent_1", position_m: [2, 0] },
          { id: "agent_2", position_m: [4, 0] }
        ]
      },
      measurements: {
        ...sceneTrace.measurements,
        uwb: [
          {
            source_id: "agent_0",
            target_id: "agent_1",
            measured_distance_m: 2,
            sigma_m: 0.1,
            true_distance_m: 2
          },
          {
            source_id: "agent_1",
            target_id: "agent_2",
            measured_distance_m: 2,
            sigma_m: 0.1,
            true_distance_m: 2
          },
          {
            source_id: "agent_0",
            target_id: "agent_2",
            measured_distance_m: 4,
            sigma_m: 0.1,
            true_distance_m: 4
          }
        ]
      }
    };

    const frame = buildLiveEstimationFrame(collinearRowTrace, 0, 3, 0);

    expect(frame.uwbLinks.map((link) => `${link.sourceId}::${link.targetId}`))
      .toEqual(["agent_0::agent_1", "agent_1::agent_2"]);
  });

  it("takes sigma from the matching measurement and falls back to the median for unmeasured pairs", () => {
    const mixedSigmaTrace: SceneTrace = {
      ...sceneTrace,
      measurements: {
        ...sceneTrace.measurements,
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
            sigma_m: 0.3,
            true_distance_m: 2
          }
        ]
      }
    };

    const frame = buildLiveEstimationFrame(mixedSigmaTrace, 0, 3, 0);
    const sigmaByPair = new Map(frame.uwbLinks.map((link) => (
      [`${link.sourceId}::${link.targetId}`, link.sigmaM]
    )));

    expect(sigmaByPair.get("agent_0::agent_1")).toBe(0.1);
    expect(sigmaByPair.get("agent_0::agent_2")).toBe(0.3);
    expect(sigmaByPair.get("agent_1::agent_2")).toBe(0.3);
  });

  it("retains a measured link across frames within the drop range", () => {
    const previouslySelectedMeasuredLink = {
      sourceId: "agent_0",
      targetId: "agent_1",
      measuredDistanceM: 2,
      sigmaM: 0.1,
      selectionReason: "new" as const
    };

    const frame = buildLiveEstimationFrame(
      sceneTrace, 0, 3, 0, null, {}, [previouslySelectedMeasuredLink]
    );
    const retainedLink = frame.uwbLinks.find((link) => (
      link.sourceId === "agent_0" && link.targetId === "agent_1"
    ));

    expect(retainedLink?.selectionReason).toBe("retained");
  });

  it("selects far-apart pairs so the per-drone cap governs the graph by default", () => {
    const farApartTrace: SceneTrace = {
      ...sceneTrace,
      truth: {
        nodes: [
          { id: "agent_0", position_m: [0, 0] },
          { id: "agent_1", position_m: [12, 0] },
          { id: "agent_2", position_m: [0, 9] }
        ]
      },
      measurements: {
        ...sceneTrace.measurements,
        gnss: sceneTrace.measurements.gnss.slice(0, 3),
        uwb: [{
          source_id: "agent_0",
          target_id: "agent_1",
          measured_distance_m: 12,
          sigma_m: 0.25,
          true_distance_m: 12
        }]
      }
    };

    const frame = buildLiveEstimationFrame(farApartTrace, 0, 3, 0);

    expect(frame.uwbSelection.candidateLinkCount).toBe(3);
    expect(frame.uwbLinks.map((link) => `${link.sourceId}::${link.targetId}`))
      .toEqual(["agent_0::agent_1", "agent_0::agent_2", "agent_1::agent_2"]);
  });

  it("limits far-apart pairs by the per-drone cap rather than by distance", () => {
    const farApartTrace: SceneTrace = {
      ...sceneTrace,
      truth: {
        nodes: [
          { id: "agent_0", position_m: [0, 0] },
          { id: "agent_1", position_m: [12, 0] },
          { id: "agent_2", position_m: [0, 9] }
        ]
      },
      measurements: {
        ...sceneTrace.measurements,
        gnss: sceneTrace.measurements.gnss.slice(0, 3),
        uwb: [{
          source_id: "agent_0",
          target_id: "agent_1",
          measured_distance_m: 12,
          sigma_m: 0.25,
          true_distance_m: 12
        }]
      }
    };

    const frame = buildLiveEstimationFrame(farApartTrace, 0, 1, 0);

    expect(frame.uwbLinks).toHaveLength(1);
  });

  it("exposes every pair as a candidate in the 10-agent ring by default", () => {
    const ringTrace: SceneTrace = {
      ...sceneTrace,
      truth: {
        nodes: Array.from({ length: 10 }, (_, index) => ({
          id: `agent_${index}`,
          position_m: [0, 0]
        }))
      },
      measurements: {
        gnss: [],
        uwb: [],
        references: []
      }
    };
    const ringAction = {
      ...defaultMissionActionState(),
      formation: "ring" as const,
      motion: "static" as const
    };
    const agentIds = ringTrace.truth.nodes.map((node) => node.id);
    const ringPositions = fallbackMissionActionPositions(agentIds, ringAction, 0);

    const sparseFrame = buildLiveEstimationFrame(
      ringTrace,
      0,
      4,
      0,
      ringAction,
      {},
      [],
      ringPositions
    );
    const denseFrame = buildLiveEstimationFrame(
      ringTrace,
      0,
      7,
      0,
      ringAction,
      {},
      [],
      ringPositions
    );
    const overRequestedFrame = buildLiveEstimationFrame(
      ringTrace,
      0,
      12,
      0,
      ringAction,
      {},
      [],
      ringPositions
    );
    const overRequestedKeys = overRequestedFrame.uwbLinks.map((link) => (
      [link.sourceId, link.targetId].sort().join("::")
    ));
    const degreeByAgent = new Map<string, number>();
    for (const link of overRequestedFrame.uwbLinks) {
      degreeByAgent.set(link.sourceId, (degreeByAgent.get(link.sourceId) ?? 0) + 1);
      degreeByAgent.set(link.targetId, (degreeByAgent.get(link.targetId) ?? 0) + 1);
    }

    expect(sparseFrame.uwbSelection.candidateLinkCount).toBe(45);
    expect(denseFrame.uwbSelection.candidateLinkCount).toBe(45);
    expect(denseFrame.uwbSelection.selectedLinkCount).toBeGreaterThan(
      sparseFrame.uwbSelection.selectedLinkCount
    );
    expect(new Set(overRequestedKeys).size).toBe(overRequestedKeys.length);
    expect(Math.max(...degreeByAgent.values())).toBeLessThanOrEqual(9);
  });
});
