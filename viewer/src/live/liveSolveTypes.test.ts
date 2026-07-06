import { describe, expect, it } from "vitest";

import {
  buildInitialLiveSolveResponse,
  buildLiveSolveRequest,
  fusedPositionMap,
  uwbConstraintNodeMap
} from "./liveSolveTypes";
import type { SceneTrace } from "../data/sceneTypes";
import { buildLiveEstimationFrame } from "../simulation/liveEstimation";
import { defaultMissionActionState } from "../simulation/missionActions";

const sceneTrace: SceneTrace = {
  schema_version: "0.1.0",
  metadata: { scenario: "live_types", units: "m", dimension: 2 },
  truth: {
    nodes: [
      { id: "agent_0", position_m: [0, 0] },
      { id: "agent_1", position_m: [3, 0] }
    ]
  },
  measurements: {
    gnss: [
      {
        agent_id: "agent_0",
        position_m: [0.2, 0],
        sigma_m: 1,
        uncertainty: { type: "circle", radius_m: 1 }
      },
      {
        agent_id: "agent_1",
        position_m: [3.1, 0],
        sigma_m: 1,
        uncertainty: { type: "circle", radius_m: 1 }
      }
    ],
    uwb: [{
      source_id: "agent_0",
      target_id: "agent_1",
      measured_distance_m: 3,
      sigma_m: 0.2,
      true_distance_m: 3
    }],
    references: []
  },
  estimates: {},
  metrics: {},
  trace: { trace_type: "residual_evaluation", iterations: [] }
};

describe("live solve type helpers", () => {
  it("builds an initial authoritative solver frame from exported scene data", () => {
    const exportedTrace: SceneTrace = {
      ...sceneTrace,
      estimates: {
        fused: [{ agent_id: "agent_0", position_m: [0.1, 0.0] }],
        gnss_only: [{ agent_id: "agent_0", position_m: [0.2, 0.0] }]
      },
      trace: {
        trace_type: "residual_evaluation",
        iterations: [{
          iteration: 3,
          positions: { agent_0: [0.1, 0.0] },
          cost: { total: 5, gnss: 2, uwb: 3, reference: 0 },
          residuals: {
            gnss: [{
              agent_id: "agent_0",
              vector: [0.1, 0.0],
              norm: 0.1,
              weighted_sq: 2
            }],
            uwb: [{
              source_id: "agent_0",
              target_id: "agent_1",
              residual_m: 0.05,
              weighted_sq: 3
            }],
            reference: []
          }
        }]
      }
    };

    const response = buildInitialLiveSolveResponse(exportedTrace);

    expect(response.metadata.solver).toBe("exported-scene-trace");
    expect(response.metadata.quality).toBeUndefined();
    expect(response.estimates.fused[0].position_m).toEqual([0.1, 0.0]);
    expect(response.trace.iterations[0].cost_total).toBe(5);
    expect(response.constraints.edges[0].measurement_type).toBe("distance_constraint");
  });

  it("builds Python solve requests from moving truth and selected UWB links", () => {
    const liveFrame = buildLiveEstimationFrame(sceneTrace, 0.5, 1, 0.2);

    const request = buildLiveSolveRequest(sceneTrace, liveFrame, 1);

    expect(request.dimension).toBe(3);
    expect(request.agents).toHaveLength(2);
    expect(request.gnss).toHaveLength(2);
    expect(request.uwb).toHaveLength(1);
    expect(request.selected_uwb_links).toEqual([{
      source_id: "agent_0",
      target_id: "agent_1"
    }]);
  });

  it("builds Python solve requests for generated mission agents", () => {
    const liveFrame = buildLiveEstimationFrame(
      sceneTrace,
      0,
      4,
      0,
      defaultMissionActionState(),
      {},
      [],
      new Map([
        ["agent_0", [0, 0, 0]],
        ["agent_1", [3, 0, 0]],
        ["agent_2", [0, 0, 3]],
        ["agent_3", [3, 0, 3]]
      ])
    );

    const request = buildLiveSolveRequest(sceneTrace, liveFrame, 4);

    expect(request.agents.map((agent) => agent.agent_id)).toEqual([
      "agent_0",
      "agent_1",
      "agent_2",
      "agent_3"
    ]);
    expect(request.gnss.map((measurement) => measurement.agent_id)).toEqual([
      "agent_0",
      "agent_1",
      "agent_2",
      "agent_3"
    ]);
    expect(request.gnss.find((measurement) => (
      measurement.agent_id === "agent_3"
    ))?.sigma_m).toBe(1);
  });

  it("keeps mission action state out of live solver request evidence", () => {
    const liveFrame = buildLiveEstimationFrame(
      sceneTrace,
      2,
      1,
      0.2,
      { ...defaultMissionActionState(), formation: "wedge", motion: "path_follow" }
    );
    const request = buildLiveSolveRequest(sceneTrace, liveFrame, 1);
    const requestRecord = request as unknown as Record<string, unknown>;

    expect(requestRecord.truth_for_solver).toBeUndefined();
    expect(requestRecord.formation_answer).toBeUndefined();
    expect(requestRecord.future_path).toBeUndefined();
    expect(requestRecord.formation).toBeUndefined();
    expect(requestRecord.motion).toBeUndefined();
  });

  it("keeps adaptive selector internals out of live solver request evidence", () => {
    const liveFrame = buildLiveEstimationFrame(sceneTrace, 0, 1, 0.2);
    const request = buildLiveSolveRequest(sceneTrace, liveFrame, 1);
    const serializedRequest = JSON.parse(JSON.stringify(request));

    expect(serializedRequest.uwb[0]).toEqual({
      source_id: "agent_0",
      target_id: "agent_1",
      distance_m: expect.any(Number),
      sigma_m: 0.2,
      true_distance_m: null
    });
    expect(JSON.stringify(serializedRequest)).not.toContain("qualityScore");
    expect(JSON.stringify(serializedRequest)).not.toContain("selectionReason");
    expect(JSON.stringify(serializedRequest)).not.toContain("candidate");
    expect(JSON.stringify(serializedRequest)).not.toContain("truth_for_solver");
  });

  it("extracts fused positions only from authoritative solver responses", () => {
    const positions = fusedPositionMap({
      schema_version: "0.1.0",
      metadata: { solver: "python-least-squares", selected_uwb_count: 1 },
      truth: [],
      measurements: { gnss: [], uwb: [] },
      estimates: {
        fused: [{ agent_id: "agent_0", position_m: [1, 2, 3] }],
        gnss_only: []
      },
      trace: { trace_type: "residual_evaluation", iterations: [] },
      constraints: { nodes: [], edges: [] }
    });

    expect(positions.get("agent_0")).toEqual([1, 2, 3]);
  });

  it("keeps one-link UWB agents as weak constraints, not UWB positions", () => {
    const nodes = uwbConstraintNodeMap({
      schema_version: "0.1.0",
      metadata: { solver: "python-least-squares", selected_uwb_count: 1 },
      truth: [],
      measurements: { gnss: [], uwb: [] },
      estimates: { fused: [], gnss_only: [] },
      trace: { trace_type: "residual_evaluation", iterations: [] },
      constraints: {
        nodes: [{
          agent_id: "agent_0",
          selected_uwb_degree: 1,
          constraint_state: "weak_uwb"
        }],
        edges: []
      }
    });

    expect(nodes.get("agent_0")?.constraint_state).toBe("weak_uwb");
    expect(nodes.get("agent_0")).not.toHaveProperty("uwb_position_m");
  });
});
