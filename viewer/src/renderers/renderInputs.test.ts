import { describe, expect, it } from "vitest";

import type { SceneTrace } from "../data/sceneTypes";
import { buildMeasurementLayerModel } from "../layers/MeasurementLayer";
import { buildResidualLayerModel } from "../layers/ResidualLayer";
import { buildSolverLayerModel } from "../layers/SolverLayer";
import { buildNodeInspectorModel } from "../ui/NodeDetailsPanel";
import { buildEdgeInspectorModel } from "../ui/EdgeDetailsPanel";
import { getCostBreakdown } from "../ui/CostBreakdownPanel";
import { getPositionErrorBreakdown } from "../ui/PositionErrorPanel";
import type { LiveSolveResponse } from "../live/liveSolveTypes";

const sceneTrace: SceneTrace = {
  schema_version: "0.1.0",
  metadata: { scenario: "render_scene", units: "m", dimension: 2 },
  truth: {
    nodes: [
      { id: "agent_0", position_m: [0, 0] },
      { id: "agent_1", position_m: [3, 0] }
    ]
  },
  measurements: {
    gnss: [{
      agent_id: "agent_0",
      position_m: [0.5, 0],
      sigma_m: 1,
      uncertainty: { type: "circle", radius_m: 1 }
    }],
    uwb: [{
      source_id: "agent_0",
      target_id: "agent_1",
      measured_distance_m: 2.8,
      sigma_m: 0.2,
      true_distance_m: 3
    }],
    references: []
  },
  estimates: {
    gnss_only: [{ agent_id: "agent_0", position_m: [0.5, 0] }],
    fused: [
      { agent_id: "agent_0", position_m: [0.1, 0] },
      { agent_id: "agent_1", position_m: [2.9, 0] }
    ]
  },
  metrics: {},
  trace: {
    trace_type: "residual_evaluation",
    iterations: [{
      iteration: 0,
      positions: { agent_0: [0.1, 0], agent_1: [2.9, 0] },
      cost: { total: 2, gnss: 1, uwb: 1, reference: 0 },
      residuals: {
        gnss: [{
          agent_id: "agent_0",
          vector: [0.4, 0],
          norm: 0.4,
          weighted_sq: 1
        }],
        uwb: [{
          source_id: "agent_0",
          target_id: "agent_1",
          residual_m: 0,
          weighted_sq: 0
        }],
        reference: []
      }
    }]
  }
};

describe("viewer render and inspector models", () => {
  it("builds measurement render inputs from exported measurements", () => {
    const model = buildMeasurementLayerModel(sceneTrace);

    expect(model.gnss[0].agentId).toBe("agent_0");
    expect(model.uwbLinks[0].measuredDistanceM).toBe(2.8);
    expect(model.uwbLinks[0].sourcePosition).toEqual([0.1, 0]);
  });

  it("builds solver and residual models from selected trace state", () => {
    const solverModel = buildSolverLayerModel(sceneTrace, 0);
    const residualModel = buildResidualLayerModel(sceneTrace, 0);

    expect(solverModel.nodes).toHaveLength(2);
    expect(residualModel.gnss[0].weightedSq).toBe(1);
    expect(residualModel.uwb[0].sourceId).toBe("agent_0");
  });

  it("builds node inspector values without fabricating missing data", () => {
    const nodeInspector = buildNodeInspectorModel(sceneTrace, "agent_0", 0);

    expect(nodeInspector?.truthPosition).toEqual([0, 0]);
    expect(nodeInspector?.connectedUwbLinks).toHaveLength(1);
    expect(nodeInspector?.referenceMeasurement).toBeNull();
  });

  it("builds edge inspector values from exported UWB and residual data", () => {
    const edgeInspector = buildEdgeInspectorModel(
      sceneTrace,
      "agent_0",
      "agent_1",
      0
    );

    expect(edgeInspector?.measuredDistanceM).toBe(2.8);
    expect(edgeInspector?.currentDistanceM).toBeCloseTo(2.8);
    expect(edgeInspector?.residualM).toBe(0);
  });

  it("builds cost and edge inspector values from live solver response when available", () => {
    const liveResponse: LiveSolveResponse = {
      schema_version: "0.1.0",
      metadata: { solver: "python-least-squares", selected_uwb_count: 1 },
      truth: [
        { agent_id: "agent_0", position_m: [0, 0, 0] },
        { agent_id: "agent_1", position_m: [3, 0, 0] }
      ],
      measurements: {
        gnss: [],
        uwb: [{
          source_id: "agent_0",
          target_id: "agent_1",
          distance_m: 3.2,
          sigma_m: 0.25
        }]
      },
      estimates: {
        fused: [
          { agent_id: "agent_0", position_m: [0, 0, 0] },
          { agent_id: "agent_1", position_m: [3.1, 0, 0] }
        ],
        gnss_only: []
      },
      trace: {
        trace_type: "residual_evaluation",
        iterations: [{
          iteration: 5,
          positions: {
            agent_0: [0, 0, 0],
            agent_1: [3.1, 0, 0]
          },
          cost_total: 9,
          cost_gnss: 2,
          cost_uwb: 7,
          gnss_residuals: [],
          uwb_residuals: [{
            source_id: "agent_0",
            target_id: "agent_1",
            residual_m: -0.1,
            weighted_sq: 0.16
          }]
        }]
      },
      constraints: {
        nodes: [],
        edges: [{
          source_id: "agent_0",
          target_id: "agent_1",
          measured_distance_m: 3.2,
          sigma_m: 0.25,
          residual_m: -0.1,
          weighted_sq: 0.16,
          measurement_type: "distance_constraint"
        }]
      }
    };

    const cost = getCostBreakdown(sceneTrace, 0, liveResponse);
    const positionError = getPositionErrorBreakdown(sceneTrace, liveResponse);
    const edgeInspector = buildEdgeInspectorModel(
      sceneTrace,
      "agent_0",
      "agent_1",
      0,
      liveResponse
    );

    expect(cost?.total).toBe(9);
    expect(cost?.uwb).toBe(7);
    expect(positionError?.estimateMethod).toBe("fused");
    expect(positionError?.rmseM).toBeCloseTo(Math.sqrt(0.01 / 2));
    expect(positionError?.maxErrorM).toBeCloseTo(0.1);
    expect(edgeInspector?.measuredDistanceM).toBe(3.2);
    expect(edgeInspector?.currentDistanceM).toBeCloseTo(3.1);
    expect(edgeInspector?.residualM).toBe(-0.1);
    expect(edgeInspector?.weightedSq).toBe(0.16);
  });

  it("uses corrected scene estimates for exported position error when available", () => {
    const correctedSceneTrace = {
      ...sceneTrace,
      estimates: {
        ...sceneTrace.estimates,
        corrected: [
          { agent_id: "agent_0", position_m: [0.05, 0] },
          { agent_id: "agent_1", position_m: [3.05, 0] }
        ]
      }
    };

    const positionError = getPositionErrorBreakdown(correctedSceneTrace);

    expect(positionError?.estimateMethod).toBe("corrected");
    expect(positionError?.rmseM).toBeCloseTo(0.05);
    expect(positionError?.meanErrorM).toBeCloseTo(0.05);
    expect(positionError?.maxErrorM).toBeCloseTo(0.05);
  });
});
