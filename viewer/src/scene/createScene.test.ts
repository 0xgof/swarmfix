import { describe, expect, it } from "vitest";
import { Group, Line, LineLoop, Mesh } from "three";

import type { LayerVisibility } from "../app/ViewerState";
import type { SceneTrace } from "../data/sceneTypes";
import type { LiveEstimationFrame } from "../simulation/liveEstimation";
import { createSwarmScene } from "./createScene";
import source from "./createScene.ts?raw";

const uncertaintyOnlyLayers: LayerVisibility = {
  truth: false,
  gnss: false,
  gnssUncertainty: true,
  gnssOnly: false,
  fused: false,
  corrected: false,
  references: false,
  uwbLinks: false,
  positionError: false,
  residuals: false,
  cost: false
};

const sceneTrace: SceneTrace = {
  schema_version: "0.1.0",
  metadata: { scenario: "scene_test", units: "m", dimension: 2 },
  truth: {
    nodes: [{ id: "agent_0", position_m: [0, 0] }]
  },
  measurements: {
    gnss: [{
      agent_id: "agent_0",
      position_m: [0.5, 0],
      sigma_m: 1,
      uncertainty: { type: "circle", radius_m: 1 }
    }],
    uwb: [],
    references: []
  },
  estimates: {
    gnss_only: [],
    fused: []
  },
  metrics: {},
  trace: {
    trace_type: "residual_evaluation",
    iterations: []
  }
};

const uwbOnlyLayers: LayerVisibility = {
  truth: false,
  gnss: false,
  gnssUncertainty: false,
  gnssOnly: false,
  fused: false,
  corrected: false,
  references: false,
  uwbLinks: true,
  positionError: false,
  residuals: false,
  cost: false
};

const truthAndFusedLayers: LayerVisibility = {
  truth: true,
  gnss: false,
  gnssUncertainty: false,
  gnssOnly: false,
  fused: true,
  corrected: false,
  references: false,
  uwbLinks: false,
  positionError: true,
  residuals: false,
  cost: false
};

const truthAndFusedWithoutPositionErrorLayers: LayerVisibility = {
  ...truthAndFusedLayers,
  positionError: false
};

const uwbSceneTrace: SceneTrace = {
  ...sceneTrace,
  truth: {
    nodes: [
      { id: "agent_0", position_m: [0, 0] },
      { id: "agent_1", position_m: [1, 0] },
      { id: "agent_2", position_m: [0, 1] }
    ]
  },
  measurements: {
    ...sceneTrace.measurements,
    uwb: [
      {
        source_id: "agent_0",
        target_id: "agent_1",
        measured_distance_m: 1,
        sigma_m: 0.1,
        true_distance_m: 1
      },
      {
        source_id: "agent_0",
        target_id: "agent_2",
        measured_distance_m: 1,
        sigma_m: 0.1,
        true_distance_m: 1
      },
      {
        source_id: "agent_1",
        target_id: "agent_2",
        measured_distance_m: Math.SQRT2,
        sigma_m: 0.1,
        true_distance_m: Math.SQRT2
      }
    ]
  }
};

function containsGnssBell(object: Group): boolean {
  const hasSurface = object.children.some((child) => child instanceof Mesh);
  const contourCount = object.children.filter((child) => child instanceof LineLoop).length;
  const outlineCount = object.children.filter((child) => (
    child instanceof Line && !(child instanceof LineLoop)
  )).length;
  const containsBell = hasSurface && contourCount > 2 && outlineCount === 2;
  return containsBell;
}

describe("createSwarmScene live solve contract", () => {
  it("does not call the browser-side approximate fusion solver", () => {
    expect(source).not.toContain("solveLiveFusion");
  });

  it("keeps the detailed GNSS bell out of the dense swarm scene", () => {
    const scene = createSwarmScene(sceneTrace, 0, uncertaintyOnlyLayers, 0, 0, 0);
    const bellGroups: Group[] = [];
    const uncertaintyClouds: Mesh[] = [];
    const groundUncertaintyGroups: Group[] = [];
    scene.traverse((object) => {
      if (object instanceof Group && containsGnssBell(object)) {
        bellGroups.push(object);
      }
      if (object instanceof Mesh && object.geometry.type === "SphereGeometry") {
        uncertaintyClouds.push(object);
      }
      if (object instanceof Group) {
        const ringMeshes = object.children.filter((child) => (
          child instanceof Mesh && child.geometry.type === "RingGeometry"
        ));
        if (ringMeshes.length === 4) {
          groundUncertaintyGroups.push(object);
        }
      }
    });

    expect(bellGroups).toHaveLength(0);
    expect(uncertaintyClouds).toHaveLength(0);
    expect(groundUncertaintyGroups).toHaveLength(1);
  });

  it("renders the selected live UWB frame instead of rebuilding another graph", () => {
    const selectedLiveFrame: LiveEstimationFrame = {
      truthPositions: new Map([
        ["agent_0", [0, 0, 0]],
        ["agent_1", [1, 0, 0]],
        ["agent_2", [0, 0, 1]]
      ]),
      gnssPositions: new Map(),
      gnssSigma: new Map(),
      uwbLinks: [{
        sourceId: "agent_0",
        targetId: "agent_2",
        measuredDistanceM: 1,
        sigmaM: 0.1,
        selectionReason: "retained"
      }],
      uwbSelection: {
        candidateLinkCount: 3,
        selectedLinkCount: 1,
        maxLinksPerAgent: 1,
        connectedComponentCount: 2,
        isolatedAgentCount: 1,
        triangleCount: 0,
        addedLinks: 0,
        droppedLinks: 0,
        selectionPolicy: "adaptive_range_graph_v1",
        adaptiveSelectionEnabled: true
      }
    };

    const scene = createSwarmScene(
      uwbSceneTrace,
      0,
      uwbOnlyLayers,
      0,
      3,
      0,
      null,
      null,
      selectedLiveFrame
    );
    const renderedEdges: Line[] = [];
    scene.traverse((object) => {
      if (object instanceof Line && object.userData.kind === "edge") {
        renderedEdges.push(object);
      }
    });

    expect(renderedEdges).toHaveLength(1);
    expect(renderedEdges[0].userData).toMatchObject({
      sourceId: "agent_0",
      targetId: "agent_2"
    });
  });

  it("draws position-error lines between truth and fused positions", () => {
    const selectedLiveFrame: LiveEstimationFrame = {
      truthPositions: new Map([
        ["agent_0", [0, 0, 0]],
        ["agent_1", [3, 0, 0]]
      ]),
      gnssPositions: new Map(),
      gnssSigma: new Map(),
      uwbLinks: [],
      uwbSelection: {
        candidateLinkCount: 0,
        selectedLinkCount: 0,
        maxLinksPerAgent: 0,
        connectedComponentCount: 2,
        isolatedAgentCount: 2,
        triangleCount: 0,
        addedLinks: 0,
        droppedLinks: 0,
        selectionPolicy: "adaptive_range_graph_v1",
        adaptiveSelectionEnabled: true
      }
    };
    const liveSolveFrame = {
      schema_version: "0.1.0",
      metadata: { solver: "test", selected_uwb_count: 0 },
      truth: [],
      measurements: { gnss: [], uwb: [] },
      estimates: {
        fused: [
          { agent_id: "agent_0", position_m: [0.5, 0, 0] },
          { agent_id: "agent_1", position_m: [3, 0, 0] }
        ],
        gnss_only: []
      },
      trace: { trace_type: "residual_evaluation", iterations: [] },
      constraints: { nodes: [], edges: [] }
    };

    const scene = createSwarmScene(
      uwbSceneTrace,
      0,
      truthAndFusedLayers,
      0,
      0,
      0,
      liveSolveFrame,
      null,
      selectedLiveFrame
    );
    const positionErrorLines: Line[] = [];
    scene.traverse((object) => {
      if (object instanceof Line && object.userData.kind === "position-error") {
        positionErrorLines.push(object);
      }
    });

    expect(positionErrorLines).toHaveLength(2);
    expect(positionErrorLines[0].userData).toMatchObject({
      agentId: "agent_0",
      errorM: 0.5
    });
    expect(positionErrorLines[1].userData).toMatchObject({
      agentId: "agent_1",
      errorM: 0
    });
  });

  it("hides position-error lines when the layer handle is off", () => {
    const selectedLiveFrame: LiveEstimationFrame = {
      truthPositions: new Map([["agent_0", [0, 0, 0]]]),
      gnssPositions: new Map(),
      gnssSigma: new Map(),
      uwbLinks: [],
      uwbSelection: {
        candidateLinkCount: 0,
        selectedLinkCount: 0,
        maxLinksPerAgent: 0,
        connectedComponentCount: 1,
        isolatedAgentCount: 1,
        triangleCount: 0,
        addedLinks: 0,
        droppedLinks: 0,
        selectionPolicy: "adaptive_range_graph_v1",
        adaptiveSelectionEnabled: true
      }
    };
    const liveSolveFrame = {
      schema_version: "0.1.0",
      metadata: { solver: "test", selected_uwb_count: 0 },
      truth: [],
      measurements: { gnss: [], uwb: [] },
      estimates: {
        fused: [{ agent_id: "agent_0", position_m: [1, 0, 0] }],
        gnss_only: []
      },
      trace: { trace_type: "residual_evaluation", iterations: [] },
      constraints: { nodes: [], edges: [] }
    };

    const scene = createSwarmScene(
      uwbSceneTrace,
      0,
      truthAndFusedWithoutPositionErrorLayers,
      0,
      0,
      0,
      liveSolveFrame,
      null,
      selectedLiveFrame
    );
    const positionErrorLines: Line[] = [];
    scene.traverse((object) => {
      if (object instanceof Line && object.userData.kind === "position-error") {
        positionErrorLines.push(object);
      }
    });

    expect(positionErrorLines).toHaveLength(0);
  });
});
