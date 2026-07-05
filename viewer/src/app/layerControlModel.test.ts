import { describe, expect, it } from "vitest";

import type { SceneTrace } from "../data/sceneTypes";
import type { LayerVisibility } from "./ViewerState";
import {
  buildIterationControlModel,
  buildLayerControlItems
} from "./layerControlModel";

const allLayersVisible: LayerVisibility = {
  truth: true,
  gnss: true,
  gnssUncertainty: true,
  gnssOnly: true,
  fused: true,
  corrected: true,
  references: true,
  uwbLinks: true,
  positionError: true,
  residuals: true,
  cost: true
};

function sceneTrace(overrides: Partial<SceneTrace> = {}): SceneTrace {
  const trace: SceneTrace = {
    schema_version: "0.1.0",
    metadata: { scenario: "grid_10_agents", units: "m", dimension: 2 },
    truth: { nodes: [{ id: "agent_0", position_m: [0, 0] }] },
    measurements: {
      gnss: [{
        agent_id: "agent_0",
        position_m: [1, 0],
        sigma_m: 1,
        uncertainty: { type: "circle", radius_m: 1 }
      }],
      uwb: [{
        source_id: "agent_0",
        target_id: "agent_1",
        measured_distance_m: 2,
        sigma_m: 0.1,
        true_distance_m: 2
      }],
      references: []
    },
    estimates: {
      fused: [{ agent_id: "agent_0", position_m: [0.5, 0] }],
      gnss_only: [{ agent_id: "agent_0", position_m: [1, 0] }]
    },
    metrics: {},
    trace: {
      trace_type: "residual_evaluation",
      iterations: [{
        iteration: 0,
        positions: { agent_0: [0.5, 0] },
        cost: { total: 2, gnss: 1, uwb: 1, reference: 0 },
        residuals: {
          gnss: [{
            agent_id: "agent_0",
            vector: [0.5, 0],
            norm: 0.5,
            weighted_sq: 0.25
          }],
          uwb: [{
            source_id: "agent_0",
            target_id: "agent_1",
            residual_m: 0.1,
            weighted_sq: 1
          }],
          reference: []
        }
      }]
    }
  };
  const mergedTrace = { ...trace, ...overrides };
  return mergedTrace;
}

function itemByKey(key: string, scene = sceneTrace(), layers = allLayersVisible) {
  const items = buildLayerControlItems(scene, layers);
  const item = items.find((candidate) => candidate.key === key);
  expect(item).toBeDefined();
  return item!;
}

describe("viewer layer control model", () => {
  it("marks reference and corrected handles unavailable when scene data is absent", () => {
    const reference = itemByKey("references");
    const corrected = itemByKey("corrected");

    expect(reference.disabled).toBe(true);
    expect(reference.reason).toContain("No reference measurements");
    expect(corrected.disabled).toBe(true);
    expect(corrected.reason).toContain("No corrected estimates");
  });

  it("keeps reference and corrected available when scene data exists", () => {
    const scene = sceneTrace({
      measurements: {
        ...sceneTrace().measurements,
        references: [{
          agent_id: "agent_0",
          position_m: [0, 0],
          sigma_m: 0.1
        }]
      },
      estimates: {
        ...sceneTrace().estimates,
        corrected: [{ agent_id: "agent_0", position_m: [0.1, 0] }]
      }
    });

    expect(itemByKey("references", scene).disabled).toBe(false);
    expect(itemByKey("corrected", scene).disabled).toBe(false);
  });

  it("keeps position error present while exposing its truth and fused dependencies", () => {
    const hiddenTruthLayers = { ...allLayersVisible, truth: false };
    const positionError = itemByKey("positionError", sceneTrace(), hiddenTruthLayers);

    expect(positionError.label).toBe("position error");
    expect(positionError.group).toBe("Diagnostics");
    expect(positionError.disabled).toBe(true);
    expect(positionError.reason).toContain("Requires truth and fused");
  });

  it("uses labels that distinguish measurements, baselines, cords, and glyphs", () => {
    expect(itemByKey("gnss").label).toBe("GNSS measurement");
    expect(itemByKey("gnssOnly").label).toBe("GNSS-only baseline");
    expect(itemByKey("uwbLinks").label).toBe("UWB cords");
    expect(itemByKey("residuals").label).toBe("GNSS residuals");
    expect(itemByKey("cost").label).toBe("GNSS cost glyphs");
  });

  it("labels single-step iteration as exported trace inspection in live mode", () => {
    const model = buildIterationControlModel(sceneTrace(), 0, true);

    expect(model.label).toBe("exported trace iteration");
    expect(model.disabled).toBe(true);
    expect(model.reason).toContain("latest live solver frame");
  });
});
