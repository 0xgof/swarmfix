import { describe, expect, it } from "vitest";

import { loadSceneTraceFromObject } from "./loadSceneTrace";

const validSceneTrace = {
  schema_version: "0.1.0",
  metadata: {
    scenario: "unit_scene",
    units: "m",
    dimension: 2
  },
  truth: {
    nodes: [{ id: "agent_0", position_m: [0, 0] }]
  },
  measurements: {
    gnss: [{
      agent_id: "agent_0",
      position_m: [0.5, 0.25],
      sigma_m: 1.2,
      uncertainty: { type: "circle", radius_m: 1.2 }
    }],
    uwb: [],
    references: []
  },
  estimates: {
    gnss_only: [{ agent_id: "agent_0", position_m: [0.5, 0.25] }],
    fused: [{ agent_id: "agent_0", position_m: [0.1, 0.1] }]
  },
  metrics: {},
  trace: {
    trace_type: "residual_evaluation",
    iterations: [{
      iteration: 0,
      positions: { agent_0: [0.5, 0.25] },
      cost: { total: 1, gnss: 1, uwb: 0, reference: 0 },
      residuals: { gnss: [], uwb: [], reference: [] }
    }]
  }
};

describe("loadSceneTraceFromObject", () => {
  it("loads a valid exported scene trace object", () => {
    const loadedScene = loadSceneTraceFromObject(validSceneTrace);

    expect(loadedScene.metadata.scenario).toBe("unit_scene");
    expect(loadedScene.trace.iterations).toHaveLength(1);
  });

  it("rejects unsupported schema versions clearly", () => {
    const unsupportedScene = {
      ...validSceneTrace,
      schema_version: "99.0.0"
    };

    expect(() => loadSceneTraceFromObject(unsupportedScene)).toThrow(
      /Unsupported scene trace schema_version/
    );
  });

  it("rejects missing required sections clearly", () => {
    const invalidScene = {
      ...validSceneTrace,
      measurements: undefined
    };

    expect(() => loadSceneTraceFromObject(invalidScene)).toThrow(
      /measurements/
    );
  });
});
