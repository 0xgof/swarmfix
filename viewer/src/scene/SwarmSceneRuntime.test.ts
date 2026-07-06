import { BufferGeometry, Line, Object3D } from "three";
import { describe, expect, it, vi } from "vitest";

import type { Position3D } from "../animation/liveMotion";
import type { SceneTrace } from "../data/sceneTypes";
import type { LayerVisibility } from "../app/ViewerState";
import type { LiveSolveResponse } from "../live/liveSolveTypes";
import type { LiveEstimationFrame } from "../simulation/liveEstimation";
import { SwarmSceneRuntime } from "./SwarmSceneRuntime";

const layers: LayerVisibility = {
  truth: true,
  gnss: true,
  gnssUncertainty: true,
  gnssOnly: true,
  fused: true,
  corrected: true,
  references: true,
  uwbLinks: true,
  positionError: true,
  residuals: false,
  cost: false
};

const sceneTrace: SceneTrace = {
  schema_version: "0.1.0",
  metadata: { scenario: "runtime_scene", units: "m", dimension: 2 },
  truth: {
    nodes: [
      { id: "agent_0", position_m: [0, 0] },
      { id: "agent_1", position_m: [2, 0] }
    ]
  },
  measurements: {
    gnss: [],
    uwb: [{
      source_id: "agent_0",
      target_id: "agent_1",
      measured_distance_m: 2,
      sigma_m: 0.1,
      true_distance_m: 2
    }],
    references: []
  },
  estimates: {},
  metrics: {},
  trace: {
    trace_type: "residual_evaluation",
    iterations: [{
      iteration: 0,
      positions: { agent_0: [0, 0], agent_1: [2, 0] },
      cost: { total: 0, gnss: 0, uwb: 0, reference: 0 },
      residuals: { gnss: [], uwb: [], reference: [] }
    }]
  }
};

const displayFrame: LiveSolveResponse = {
  schema_version: "0.1.0",
  metadata: { solver: "test", selected_uwb_count: 1 },
  truth: [
    { agent_id: "agent_0", position_m: [0, 0, 0] },
    { agent_id: "agent_1", position_m: [2, 0, 0] }
  ],
  measurements: { gnss: [], uwb: [] },
  estimates: {
    fused: [
      { agent_id: "agent_0", position_m: [0.5, 0, 0] },
      { agent_id: "agent_1", position_m: [2.5, 0, 0] }
    ],
    gnss_only: []
  },
  trace: {
    trace_type: "live_solve",
    iterations: [{
      iteration: 0,
      positions: { agent_0: [0.5, 0, 0], agent_1: [2.5, 0, 0] },
      cost_total: 1,
      cost_gnss: 1,
      cost_uwb: 0,
      gnss_residuals: [{
        agent_id: "agent_0",
        vector: [0.5, 0, 0],
        norm: 0.5,
        weighted_sq: 1
      }],
      uwb_residuals: []
    }]
  },
  constraints: { nodes: [], edges: [] }
};

function firstGeometry(object: Object3D): BufferGeometry | null {
  let geometry: BufferGeometry | null = null;
  object.traverse((candidate) => {
    const maybeGeometry = (candidate as { geometry?: BufferGeometry }).geometry;
    if (!geometry && maybeGeometry) {
      geometry = maybeGeometry;
    }
  });
  return geometry;
}

function objectByUserData(sceneObject: Object3D,
                          predicate: (userData: Record<string, unknown>) => boolean): Object3D | null {
  let match: Object3D | null = null;
  sceneObject.traverse((candidate) => {
    if (!match && predicate(candidate.userData)) {
      match = candidate;
    }
  });
  return match;
}

function positionsFromGeometry(line: Line): number[] {
  const positions = Array.from(
    line.geometry.getAttribute("position").array as ArrayLike<number>
  );
  return positions;
}

const defaultUwbSelection = {
  candidateLinkCount: 1,
  selectedLinkCount: 1,
  maxLinksPerAgent: 1,
  connectedComponentCount: 1,
  isolatedAgentCount: 0,
  triangleCount: 0,
  addedLinks: 1,
  droppedLinks: 0,
  selectionPolicy: "adaptive_range_graph_v1" as const,
  adaptiveSelectionEnabled: true as const
};

function makeLiveFrame(overrides: Partial<LiveEstimationFrame> = {}): LiveEstimationFrame {
  const base: LiveEstimationFrame = {
    truthPositions: new Map<string, Position3D>([
      ["agent_0", [0, 0, 0]],
      ["agent_1", [2, 0, 0]]
    ]),
    gnssPositions: new Map<string, Position3D>([
      ["agent_0", [0.1, 0, 0]],
      ["agent_1", [2.1, 0, 0]]
    ]),
    gnssSigma: new Map<string, number>([["agent_0", 1], ["agent_1", 1]]),
    uwbLinks: [{
      sourceId: "agent_0",
      targetId: "agent_1",
      measuredDistanceM: 2,
      sigmaM: 0.1,
      selectionReason: "new"
    }],
    uwbSelection: defaultUwbSelection
  };
  return { ...base, ...overrides };
}

describe("SwarmSceneRuntime", () => {
  it("reuses one scene object across frame updates", () => {
    const runtime = new SwarmSceneRuntime();

    runtime.updateFrame({
      sceneTrace,
      selectedIteration: 0,
      layers,
      timeSeconds: 0,
      maxUwbLinksPerAgent: 1,
      motionAmplitudeM: 0.24,
      displayFrame,
      missionAction: null,
      liveFrame: makeLiveFrame()
    });
    const firstScene = runtime.scene;
    runtime.updateFrame({
      sceneTrace,
      selectedIteration: 0,
      layers,
      timeSeconds: 0.1,
      maxUwbLinksPerAgent: 1,
      motionAmplitudeM: 0.24,
      displayFrame,
      missionAction: null,
      liveFrame: makeLiveFrame()
    });

    expect(runtime.scene).toBe(firstScene);
  });

  it("disposes owned geometry when content is replaced and destroyed", () => {
    const runtime = new SwarmSceneRuntime();

    runtime.updateFrame({
      sceneTrace,
      selectedIteration: 0,
      layers,
      timeSeconds: 0,
      maxUwbLinksPerAgent: 1,
      motionAmplitudeM: 0.24,
      displayFrame,
      missionAction: null,
      liveFrame: makeLiveFrame()
    });
    const geometry = firstGeometry(runtime.scene);
    expect(geometry).not.toBeNull();
    const disposeSpy = vi.spyOn(geometry!, "dispose");

    runtime.updateFrame({
      sceneTrace,
      selectedIteration: 0,
      layers,
      timeSeconds: 0.2,
      maxUwbLinksPerAgent: 1,
      motionAmplitudeM: 0.24,
      displayFrame: null,
      missionAction: null,
      liveFrame: makeLiveFrame()
    });
    runtime.dispose();

    expect(disposeSpy).toHaveBeenCalled();
    expect(runtime.scene.children).toHaveLength(0);
  });

  it("reuses marker objects and mutates their positions across frame updates", () => {
    const runtime = new SwarmSceneRuntime();
    const firstFrame: LiveEstimationFrame = {
      truthPositions: new Map<string, Position3D>([["agent_0", [0, 0, 0]]]),
      gnssPositions: new Map<string, Position3D>(),
      gnssSigma: new Map<string, number>(),
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
    const secondFrame: LiveEstimationFrame = {
      ...firstFrame,
      truthPositions: new Map<string, Position3D>([["agent_0", [5, 0, 0]]])
    };

    runtime.updateFrame({
      sceneTrace,
      selectedIteration: 0,
      layers,
      timeSeconds: 0,
      maxUwbLinksPerAgent: 1,
      motionAmplitudeM: 0.24,
      displayFrame: null,
      missionAction: null,
      liveFrame: firstFrame
    });
    const firstMarker = objectByUserData(runtime.scene, (userData) => (
      userData.kind === "node"
      && userData.agentId === "agent_0"
      && userData.layer === "truth"
    ));
    expect(firstMarker).not.toBeNull();

    runtime.updateFrame({
      sceneTrace,
      selectedIteration: 0,
      layers,
      timeSeconds: 0.1,
      maxUwbLinksPerAgent: 1,
      motionAmplitudeM: 0.24,
      displayFrame: null,
      missionAction: null,
      liveFrame: secondFrame
    });
    const secondMarker = objectByUserData(runtime.scene, (userData) => (
      userData.kind === "node"
      && userData.agentId === "agent_0"
      && userData.layer === "truth"
    ));

    expect(secondMarker).toBe(firstMarker);
    expect(secondMarker!.position.x).toBe(5);
  });

  it("toggles marker layer visibility without recreating marker objects", () => {
    const runtime = new SwarmSceneRuntime();

    runtime.updateFrame({
      sceneTrace,
      selectedIteration: 0,
      layers,
      timeSeconds: 0,
      maxUwbLinksPerAgent: 1,
      motionAmplitudeM: 0.24,
      displayFrame: null,
      missionAction: null,
      liveFrame: makeLiveFrame()
    });
    const visibleMarker = objectByUserData(runtime.scene, (userData) => (
      userData.kind === "node"
      && userData.agentId === "agent_0"
      && userData.layer === "truth"
    ));
    const hiddenLayers = { ...layers, truth: false };

    runtime.updateFrame({
      sceneTrace,
      selectedIteration: 0,
      layers: hiddenLayers,
      timeSeconds: 0.1,
      maxUwbLinksPerAgent: 1,
      motionAmplitudeM: 0.24,
      displayFrame,
      missionAction: null,
      liveFrame: makeLiveFrame()
    });
    const hiddenMarker = objectByUserData(runtime.scene, (userData) => (
      userData.kind === "node"
      && userData.agentId === "agent_0"
      && userData.layer === "truth"
    ));

    expect(hiddenMarker).toBe(visibleMarker);
    expect(hiddenMarker!.visible).toBe(false);
  });

  it("rebuilds marker membership when the scenario agent set changes", () => {
    const runtime = new SwarmSceneRuntime();
    const nextTrace = {
      ...sceneTrace,
      truth: { nodes: [{ id: "agent_2", position_m: [8, 0] }] },
      measurements: { gnss: [], uwb: [], references: [] }
    };

    runtime.updateFrame({
      sceneTrace,
      selectedIteration: 0,
      layers,
      timeSeconds: 0,
      maxUwbLinksPerAgent: 1,
      motionAmplitudeM: 0.24,
      displayFrame: null,
      missionAction: null,
      liveFrame: makeLiveFrame()
    });
    runtime.updateFrame({
      sceneTrace: nextTrace,
      selectedIteration: 0,
      layers,
      timeSeconds: 0.1,
      maxUwbLinksPerAgent: 1,
      motionAmplitudeM: 0.24,
      displayFrame: null,
      missionAction: null,
      liveFrame: makeLiveFrame({
        truthPositions: new Map<string, Position3D>([["agent_2", [8, 0, 0]]]),
        gnssPositions: new Map<string, Position3D>([["agent_2", [8, 0, 0]]]),
        gnssSigma: new Map<string, number>([["agent_2", 1]]),
        uwbLinks: []
      })
    });

    expect(objectByUserData(runtime.scene, (userData) => userData.agentId === "agent_0"))
      .toBeNull();
    expect(objectByUserData(runtime.scene, (userData) => userData.agentId === "agent_2"))
      .not.toBeNull();
  });

  it("reuses UWB link objects while mutating geometry buffers", () => {
    const runtime = new SwarmSceneRuntime();

    runtime.updateFrame({
      sceneTrace,
      selectedIteration: 0,
      layers,
      timeSeconds: 0,
      maxUwbLinksPerAgent: 1,
      motionAmplitudeM: 0.24,
      displayFrame: null,
      missionAction: null,
      liveFrame: makeLiveFrame()
    });
    const firstLink = objectByUserData(runtime.scene, (userData) => (
      userData.kind === "edge"
      && userData.sourceId === "agent_0"
      && userData.targetId === "agent_1"
    )) as Line | null;
    expect(firstLink).not.toBeNull();
    const firstPositions = positionsFromGeometry(firstLink!);

    runtime.updateFrame({
      sceneTrace,
      selectedIteration: 0,
      layers,
      timeSeconds: 1,
      maxUwbLinksPerAgent: 1,
      motionAmplitudeM: 0.24,
      displayFrame: null,
      missionAction: null,
      liveFrame: makeLiveFrame({
        truthPositions: new Map<string, Position3D>([
          ["agent_0", [0, 0, 0]],
          ["agent_1", [3, 0, 0]]
        ]),
        uwbLinks: [{
          sourceId: "agent_0",
          targetId: "agent_1",
          measuredDistanceM: 3,
          sigmaM: 0.1,
          selectionReason: "retained"
        }]
      })
    });
    const secondLink = objectByUserData(runtime.scene, (userData) => (
      userData.kind === "edge"
      && userData.sourceId === "agent_0"
      && userData.targetId === "agent_1"
    )) as Line | null;

    expect(secondLink).toBe(firstLink);
    expect(positionsFromGeometry(secondLink!)).not.toEqual(firstPositions);
  });

  it("disposes removed UWB links and creates new links with picking metadata", () => {
    const runtime = new SwarmSceneRuntime();
    const noUwbTrace = {
      ...sceneTrace,
      measurements: { ...sceneTrace.measurements, uwb: [] }
    };

    runtime.updateFrame({
      sceneTrace,
      selectedIteration: 0,
      layers,
      timeSeconds: 0,
      maxUwbLinksPerAgent: 1,
      motionAmplitudeM: 0.24,
      displayFrame: null,
      missionAction: null,
      liveFrame: makeLiveFrame()
    });
    const firstLink = (
      objectByUserData(runtime.scene, (userData) => userData.kind === "edge") as Line | null
    );
    expect(firstLink).not.toBeNull();
    const disposeSpy = vi.spyOn(firstLink!.geometry, "dispose");

    runtime.updateFrame({
      sceneTrace: noUwbTrace,
      selectedIteration: 0,
      layers,
      timeSeconds: 0.1,
      maxUwbLinksPerAgent: 0,
      motionAmplitudeM: 0.24,
      displayFrame: null,
      missionAction: null,
      liveFrame: makeLiveFrame({ uwbLinks: [] })
    });

    expect(disposeSpy).toHaveBeenCalled();
    expect(objectByUserData(runtime.scene, (userData) => userData.kind === "edge"))
      .toBeNull();
  });

  it("skips hidden diagnostic geometry work and removes stale diagnostics", () => {
    const runtime = new SwarmSceneRuntime();
    const diagnosticLayers = { ...layers, positionError: true };
    const hiddenDiagnosticLayers = { ...layers, positionError: false };

    runtime.updateFrame({
      sceneTrace,
      selectedIteration: 0,
      layers: diagnosticLayers,
      timeSeconds: 0,
      maxUwbLinksPerAgent: 1,
      motionAmplitudeM: 0.24,
      displayFrame,
      missionAction: null,
      liveFrame: makeLiveFrame()
    });
    const positionError = objectByUserData(runtime.scene, (userData) => (
      userData.kind === "position-error"
    ));
    expect(positionError).not.toBeNull();

    runtime.updateFrame({
      sceneTrace,
      selectedIteration: 0,
      layers: hiddenDiagnosticLayers,
      timeSeconds: 0.1,
      maxUwbLinksPerAgent: 1,
      motionAmplitudeM: 0.24,
      displayFrame,
      missionAction: null,
      liveFrame: makeLiveFrame()
    });

    expect(objectByUserData(runtime.scene, (userData) => userData.kind === "position-error"))
      .toBeNull();
  });
});
