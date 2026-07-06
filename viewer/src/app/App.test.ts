import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SceneTrace } from "../data/sceneTypes";
import type { LiveEstimationFrame } from "../simulation/liveEstimation";

const renderMock = vi.fn();
const setSizeMock = vi.fn();
const disposeMock = vi.fn();
const forceContextLossMock = vi.fn();
const setPixelRatioMock = vi.fn();
const updateMock = vi.fn();
const controlsDisposeMock = vi.fn();
const addEventListenerMock = vi.fn();
const controlsTargetState = { x: 0, y: 0, z: 0 };
const targetSetMock = vi.fn((x: number, y: number, z: number) => {
  controlsTargetState.x = x;
  controlsTargetState.y = y;
  controlsTargetState.z = z;
});

vi.mock("three", async () => {
  const actual = await vi.importActual<typeof import("three")>("three");

  class MockWebGLRenderer {
    domElement = document.createElement("canvas");

    constructor() {
      this.domElement.addEventListener = addEventListenerMock;
    }

    setPixelRatio = setPixelRatioMock;
    setSize = setSizeMock;
    render = renderMock;
    dispose = disposeMock;
    forceContextLoss = forceContextLossMock;
  }

  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer
  };
});

vi.mock("three/examples/jsm/controls/OrbitControls.js", () => ({
  OrbitControls: class MockOrbitControls {
    enableDamping = false;
    target = {
      get x(): number {
        return controlsTargetState.x;
      },
      get y(): number {
        return controlsTargetState.y;
      },
      get z(): number {
        return controlsTargetState.z;
      },
      set: targetSetMock
    };
    update = updateMock;
    dispose = controlsDisposeMock;
  }
}));

import { App } from "./App";

import type { Position3D } from "../animation/liveMotion";

const mountedApps: App[] = [];

function createTestApp(root: HTMLElement): App {
  const app = new App(root);
  mountedApps.push(app);
  return app;
}

type CameraFollowTestAccess = {
  updateCameraFollowTarget: (liveFrame: LiveEstimationFrame | null) => void;
};

type MissionPositionTestAccess = {
  requestBackendMissionPositions: (timeSeconds: number) => void;
  missionPositionsForLiveFrame: (timeSeconds: number) => Map<string, Position3D>;
};

type DiagnosticHistoryTestAccess = {
  diagnosticHistorySampleCount: () => number;
};

type DiagnosticSampleAppendTestAccess = {
  appendDiagnosticSample: (
    timeSeconds: number,
    liveFrame: LiveEstimationFrame | null,
    displayFrame: unknown
  ) => void;
  eventBuffer: {
    snapshot: () => Array<{ event: string; fields: Record<string, unknown> }>;
  };
};

type LiveSolveSchedulerTestAccess = {
  liveSolveScheduler: {
    frameChanged: boolean;
    latestSolvedFrame: unknown;
    previousSolvedFrame: unknown;
  };
};

class FakeBroadcastChannel {
  static postedMessages: unknown[] = [];
  name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(name: string) {
    this.name = name;
  }

  postMessage(message: unknown): void {
    FakeBroadcastChannel.postedMessages.push(message);
  }

  close(): void {
    return undefined;
  }
}

function cameraDistanceFromFollowTarget(camera: NonNullable<ReturnType<App["getCameraForTest"]>>): number {
  const distanceM = Math.hypot(
    camera.position.x - controlsTargetState.x,
    camera.position.y - controlsTargetState.y,
    camera.position.z - controlsTargetState.z
  );
  return distanceM;
}

function liveFrameFromPositions(
  positions: Array<[string, [number, number, number]]>
): LiveEstimationFrame {
  const liveFrame: LiveEstimationFrame = {
    truthPositions: new Map(positions),
    gnssPositions: new Map(),
    gnssSigma: new Map(),
    uwbLinks: [],
    uwbSelection: {
      candidateLinkCount: 0,
      selectedLinkCount: 0,
      maxLinksPerAgent: 0,
      connectedComponentCount: 0,
      isolatedAgentCount: 0,
      triangleCount: 0,
      addedLinks: 0,
      droppedLinks: 0,
      selectionPolicy: "adaptive_range_graph_v1",
      adaptiveSelectionEnabled: true
    }
  };
  return liveFrame;
}

function diagnosticSampleCount(app: App): number {
  const sampleCount = (app as unknown as DiagnosticHistoryTestAccess)
    .diagnosticHistorySampleCount();
  return sampleCount;
}

function seedChangedLiveSolveFrame(app: App): void {
  const schedulerAccess = app as unknown as LiveSolveSchedulerTestAccess;
  schedulerAccess.liveSolveScheduler.previousSolvedFrame = null;
  schedulerAccess.liveSolveScheduler.latestSolvedFrame = {
    schema_version: "0.1.0",
    metadata: { solver: "test", selected_uwb_count: 0 },
    truth: [{ agent_id: "agent_0", position_m: [0, 0, 0] }],
    measurements: { gnss: [], uwb: [] },
    estimates: { fused: [{ agent_id: "agent_0", position_m: [0.1, 0, 0] }], gnss_only: [] },
    trace: {
      trace_type: "live_solve",
      iterations: [{
        iteration: 0,
        positions: { agent_0: [0.1, 0, 0] },
        cost_total: 1,
        cost_gnss: 0.5,
        cost_uwb: 0.5,
        gnss_residuals: [],
        uwb_residuals: []
      }]
    },
    constraints: { nodes: [], edges: [] }
  };
  schedulerAccess.liveSolveScheduler.frameChanged = true;
}

function liveFrameWithHorizontalRadius(radiusM: number): LiveEstimationFrame {
  const liveFrame = liveFrameFromPositions([
    ["agent_0", [-radiusM, 0, 0]],
    ["agent_1", [radiusM, 0, 0]]
  ]);
  return liveFrame;
}

afterEach(() => {
  for (const app of mountedApps) {
    app.destroy();
  }
  mountedApps.length = 0;
});

const sceneTrace: SceneTrace = {
  schema_version: "0.1.0",
  metadata: { scenario: "app_scene", units: "m", dimension: 2 },
  truth: { nodes: [{ id: "agent_0", position_m: [0, 0] }] },
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

describe("App camera lifecycle", () => {
  beforeEach(() => {
    renderMock.mockClear();
    setSizeMock.mockClear();
    disposeMock.mockClear();
    forceContextLossMock.mockClear();
    setPixelRatioMock.mockClear();
    updateMock.mockClear();
    controlsDisposeMock.mockClear();
    addEventListenerMock.mockClear();
    targetSetMock.mockClear();
    controlsTargetState.x = 0;
    controlsTargetState.y = 0;
    controlsTargetState.z = 0;
  });

  it("preserves the camera when menu controls refresh scene content", () => {
    const root = document.createElement("div");
    const app = createTestApp(root);

    app.mount(sceneTrace);
    const cameraBeforeControlChange = app.getCameraForTest();
    const uwbSlider = root.querySelector<HTMLInputElement>(".link-count-control input");

    expect(uwbSlider).not.toBeNull();
    uwbSlider!.value = "0";
    uwbSlider!.dispatchEvent(new Event("input"));

    expect(app.getCameraForTest()).toBe(cameraBeforeControlChange);
    expect(disposeMock).not.toHaveBeenCalled();
  });

  it("updates the UWB link slider limit when the mission drone count changes", () => {
    const root = document.createElement("div");
    const app = createTestApp(root);

    app.mount(sceneTrace);
    const droneCount = root.querySelector<HTMLSelectElement>('[name="missionDroneCount"]')!;
    droneCount.value = "50";
    droneCount.dispatchEvent(new Event("change"));
    const uwbSlider = root.querySelector<HTMLInputElement>(".link-count-control input")!;

    expect(uwbSlider.max).toBe("20");
  });

  it("keeps the selected UWB graph stable when formation changes begin", () => {
    const root = document.createElement("div");
    const app = createTestApp(root);

    app.mount(sceneTrace);
    const droneCount = root.querySelector<HTMLSelectElement>('[name="missionDroneCount"]')!;
    droneCount.value = "2";
    droneCount.dispatchEvent(new Event("change"));
    const uwbSlider = root.querySelector<HTMLInputElement>(".link-count-control input")!;
    uwbSlider.value = "1";
    uwbSlider.dispatchEvent(new Event("input"));
    const existingSelectedLinks = [{
      sourceId: "agent_0",
      targetId: "agent_1",
      measuredDistanceM: 2,
      sigmaM: 0.1,
      selectionReason: "retained" as const
    }];
    (app as unknown as { previousSelectedUwbLinks: typeof existingSelectedLinks })
      .previousSelectedUwbLinks = existingSelectedLinks;
    const formation = root.querySelector<HTMLSelectElement>('[name="formation"]')!;
    formation.value = "line";
    formation.dispatchEvent(new Event("change"));

    expect(
      (app as unknown as { previousSelectedUwbLinks: typeof existingSelectedLinks })
        .previousSelectedUwbLinks
    ).toEqual([expect.objectContaining({
      sourceId: "agent_0",
      targetId: "agent_1",
      selectionReason: "retained"
    })]);
  });

  it("renders one persistent scene across animation frames", () => {
    const animationCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        animationCallbacks.push(callback);
        return animationCallbacks.length;
      });
    const cancelAnimationFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
    const root = document.createElement("div");
    const app = createTestApp(root);

    try {
      app.mount(sceneTrace);
      animationCallbacks[0](16);
      animationCallbacks[1](32);
    } finally {
      requestAnimationFrameSpy.mockRestore();
      cancelAnimationFrameSpy.mockRestore();
    }

    expect(renderMock).toHaveBeenCalledTimes(2);
    expect(renderMock.mock.calls[1][0]).toBe(renderMock.mock.calls[0][0]);
  });

  it("mounts mission action controls and records action context on solve events", async () => {
    const flushedEvents: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const flushedPerformance: Array<{
      metric_name: string;
      fields: Record<string, unknown>;
    }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      const url = String(input);
      if (url.includes("/observability/events") && init?.body) {
        flushedEvents.push(...JSON.parse(String(init.body)));
        return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
      }
      if (url.includes("/observability/performance") && init?.body) {
        flushedPerformance.push(...JSON.parse(String(init.body)));
        return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
      }
      throw new Error("NetworkError when attempting to fetch resource.");
    }));
    const root = document.createElement("div");
    const app = createTestApp(root);

    app.mount(sceneTrace);
    const formation = root.querySelector<HTMLSelectElement>('[name="formation"]');
    const motion = root.querySelector<HTMLSelectElement>('[name="motion"]');
    expect(formation).not.toBeNull();
    expect(motion).not.toBeNull();
    formation!.value = "line";
    formation!.dispatchEvent(new Event("change"));
    motion!.value = "forward";
    motion!.dispatchEvent(new Event("change"));

    await vi.waitFor(() => {
      const failedEvent = flushedEvents.find(
        (candidate) => (
          candidate.event === "viewer_live_solve_failed"
          && candidate.fields.formation_mode === "line"
          && candidate.fields.motion_mode === "forward"
        )
      );
      expect(failedEvent).toBeDefined();
      expect(failedEvent!.fields.formation_mode).toBe("line");
      expect(failedEvent!.fields.motion_mode).toBe("forward");
    });
    await vi.waitFor(() => {
      const frameSample = flushedPerformance.find(
        (sample) => (
          sample.metric_name === "frame_ms"
          && sample.fields.formation_mode === "line"
          && sample.fields.motion_mode === "forward"
        )
      );
      expect(frameSample).toBeDefined();
    });
  });

  it("loads backend mission-action metadata and requests backend mission positions", async () => {
    let positionsRequestBody: Record<string, unknown> | null = null;
    let solveEndpoint = "";
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      const url = String(input);
      if (url.includes("/mission-actions/catalog")) {
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({
            schema_version: "0.1.0",
            formations: [{
              id: "ring",
              label: "backend ring",
              description: "backend ring option",
              parameters: [],
              geometry_traits: ["planar"],
              solver_geometry_risk: "low"
            }],
            motions: [{
              id: "static",
              label: "backend static",
              description: "backend static option",
              parameters: [],
              geometry_traits: [],
              solver_geometry_risk: "low"
            }]
          })
        };
      }
      if (url.includes("/mission-actions/positions") && init?.body) {
        positionsRequestBody = JSON.parse(String(init.body));
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({
            schema_version: "0.1.0",
            metadata: {
              formation: "grid",
              motion: "random_walk",
              time_s: 0
            },
            positions: [{
              agent_id: "agent_0",
              position_m: [0, 0, 0]
            }]
          })
        };
      }
      if (url.includes("/observability/")) {
        return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
      }
      if (url.includes("/live/frame")) {
        solveEndpoint = url;
        throw new Error("NetworkError when attempting to fetch resource.");
      }
      throw new Error("NetworkError when attempting to fetch resource.");
    }));
    const root = document.createElement("div");
    const app = createTestApp(root);

    app.mount(sceneTrace);

    await vi.waitFor(() => {
      const formationOptions = Array.from(
        root.querySelectorAll<HTMLOptionElement>('[name="formation"] option')
      );
      expect(formationOptions.map((option) => option.textContent)).toContain(
        "backend ring"
      );
    });
    await vi.waitFor(() => {
      expect(positionsRequestBody).not.toBeNull();
    });
    await vi.waitFor(() => {
      expect(solveEndpoint).toBe("http://127.0.0.1:8765/live/frame");
    });

    expect(positionsRequestBody).toMatchObject({
      agent_ids: ["agent_0"],
      mission_action: {
        formation: "grid",
        motion: "random_walk"
      }
    });
  });

  it("requests backend mission positions for the user-selected drone count", async () => {
    const positionRequests: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      const url = String(input);
      if (url.includes("/mission-actions/catalog")) {
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({
            schema_version: "0.1.0",
            formations: [],
            motions: []
          })
        };
      }
      if (url.includes("/mission-actions/positions") && init?.body) {
        positionRequests.push(JSON.parse(String(init.body)));
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({
            schema_version: "0.1.0",
            metadata: {
              formation: "grid",
              motion: "random_walk",
              time_s: 0
            },
            positions: Array.from({ length: 4 }, (_, index) => ({
              agent_id: `agent_${index}`,
              position_m: [index, 0, 0]
            }))
          })
        };
      }
      if (url.includes("/observability/")) {
        return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
      }
      if (url.includes("/solve")) {
        throw new Error("NetworkError when attempting to fetch resource.");
      }
      throw new Error("NetworkError when attempting to fetch resource.");
    }));
    const root = document.createElement("div");
    const app = createTestApp(root);

    app.mount(sceneTrace);
    const droneCount = root.querySelector<HTMLSelectElement>('[name="missionDroneCount"]')!;
    droneCount.value = "4";
    droneCount.dispatchEvent(new Event("change"));

    await vi.waitFor(() => {
      expect(positionRequests.some((request) => (
        JSON.stringify(request.agent_ids) === JSON.stringify([
          "agent_0",
          "agent_1",
          "agent_2",
          "agent_3"
        ])
      ))).toBe(true);
    });
  });

  it("requests backend mission positions at display cadence", async () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(() => 1);
    const cancelAnimationFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
    const backendSamples: Position3D[] = [
      [0, 0, 0],
      [10, 0, 0]
    ];
    const positionRequests: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      const url = String(input);
      if (url.includes("/mission-actions/catalog")) {
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({
            schema_version: "0.1.0",
            formations: [],
            motions: []
          })
        };
      }
      if (url.includes("/mission-actions/positions") && init?.body) {
        positionRequests.push(JSON.parse(String(init.body)));
        const sample = backendSamples[Math.min(positionRequests.length - 1, 1)];
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({
            schema_version: "0.1.0",
            metadata: {
              formation: "grid",
              motion: "forward",
              time_s: positionRequests.length === 1 ? 0 : 0.25
            },
            positions: [{
              agent_id: "agent_0",
              position_m: sample
            }]
          })
        };
      }
      if (url.includes("/observability/")) {
        return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
      }
      if (url.includes("/solve")) {
        throw new Error("NetworkError when attempting to fetch resource.");
      }
      throw new Error("NetworkError when attempting to fetch resource.");
    }));
    const root = document.createElement("div");
    const app = createTestApp(root);
    const missionAccess = app as unknown as MissionPositionTestAccess;

    try {
      app.mount(sceneTrace);
      await vi.waitFor(() => {
        expect(positionRequests).toHaveLength(1);
      });
      await vi.waitFor(() => {
        expect(missionAccess.missionPositionsForLiveFrame(0).get("agent_0")).toEqual(
          [0, 0, 0]
        );
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const firstRequestTimeSeconds = Number(positionRequests[0].time_s);
      const nextRequestTimeSeconds = firstRequestTimeSeconds + 0.04;
      missionAccess.requestBackendMissionPositions(nextRequestTimeSeconds);
      await vi.waitFor(() => {
        expect(positionRequests).toHaveLength(2);
      });

      await vi.waitFor(() => {
        const backendPosition = missionAccess.missionPositionsForLiveFrame(nextRequestTimeSeconds)
          .get("agent_0");

        expect(backendPosition).toEqual([10, 0, 0]);
      });
    } finally {
      requestAnimationFrameSpy.mockRestore();
      cancelAnimationFrameSpy.mockRestore();
    }
  });

  it("reduces backend mission-position cadence for static motion", async () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(() => 1);
    const cancelAnimationFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
    const positionRequests: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      const url = String(input);
      if (url.includes("/mission-actions/catalog")) {
        return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
      }
      if (url.includes("/mission-actions/positions") && init?.body) {
        positionRequests.push(JSON.parse(String(init.body)));
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({
            schema_version: "0.1.0",
            metadata: { formation: "grid", motion: "static", time_s: 0 },
            positions: [{ agent_id: "agent_0", position_m: [0, 0, 0] }]
          })
        };
      }
      if (url.includes("/observability/")) {
        return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
      }
      throw new Error("NetworkError when attempting to fetch resource.");
    }));
    const root = document.createElement("div");
    const app = createTestApp(root);
    const missionAccess = app as unknown as MissionPositionTestAccess;

    try {
      app.mount(sceneTrace);
      const motion = root.querySelector<HTMLSelectElement>('[name="motion"]')!;
      motion.value = "static";
      motion.dispatchEvent(new Event("change"));
      await vi.waitFor(() => {
        expect(positionRequests).toHaveLength(1);
      });
      await vi.waitFor(() => {
        expect(missionAccess.missionPositionsForLiveFrame(0).get("agent_0")).toEqual(
          [0, 0, 0]
        );
      });
      await Promise.resolve();

      missionAccess.requestBackendMissionPositions(100.0);
      await vi.waitFor(() => {
        expect(positionRequests).toHaveLength(2);
      });

      missionAccess.requestBackendMissionPositions(100.5);
      await Promise.resolve();
      expect(positionRequests).toHaveLength(2);

      missionAccess.requestBackendMissionPositions(101.1);
      await vi.waitFor(() => {
        expect(positionRequests).toHaveLength(3);
      });
    } finally {
      requestAnimationFrameSpy.mockRestore();
      cancelAnimationFrameSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("applies backend mission-position responses without forcing an extra render", async () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(() => 1);
    const cancelAnimationFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/mission-actions/catalog")) {
        return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
      }
      if (url.includes("/mission-actions/positions")) {
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({
            schema_version: "0.1.0",
            metadata: { formation: "grid", motion: "forward", time_s: 0 },
            positions: [{ agent_id: "agent_0", position_m: [5, 0, 0] }]
          })
        };
      }
      if (url.includes("/observability/")) {
        return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
      }
      throw new Error("NetworkError when attempting to fetch resource.");
    }));
    const root = document.createElement("div");
    const app = createTestApp(root);

    try {
      app.mount(sceneTrace);
      renderMock.mockClear();
      await Promise.resolve();
      await Promise.resolve();

      expect(renderMock).not.toHaveBeenCalled();
    } finally {
      requestAnimationFrameSpy.mockRestore();
      cancelAnimationFrameSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("keeps backend mission positions through a transient refresh failure", async () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(() => 1);
    const cancelAnimationFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
    let positionRequestCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/mission-actions/catalog")) {
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({
            schema_version: "0.1.0",
            formations: [],
            motions: []
          })
        };
      }
      if (url.includes("/mission-actions/positions")) {
        positionRequestCount += 1;
        if (positionRequestCount > 1) {
          throw new Error("NetworkError when attempting to fetch resource.");
        }
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({
            schema_version: "0.1.0",
            metadata: {
              formation: "grid",
              motion: "forward",
              time_s: 0
            },
            positions: [{
              agent_id: "agent_0",
              position_m: [5, 0, 0]
            }]
          })
        };
      }
      if (url.includes("/observability/")) {
        return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
      }
      if (url.includes("/solve")) {
        throw new Error("NetworkError when attempting to fetch resource.");
      }
      throw new Error("NetworkError when attempting to fetch resource.");
    }));
    const root = document.createElement("div");
    const app = createTestApp(root);
    const missionAccess = app as unknown as MissionPositionTestAccess;

    try {
      app.mount(sceneTrace);
      await vi.waitFor(() => {
        expect(positionRequestCount).toBe(1);
      });
      await vi.waitFor(() => {
        expect(missionAccess.missionPositionsForLiveFrame(0).get("agent_0")).toEqual(
          [5, 0, 0]
        );
      });
      await Promise.resolve();

      missionAccess.requestBackendMissionPositions(1.0);
      await vi.waitFor(() => {
        expect(positionRequestCount).toBe(2);
      });
      await Promise.resolve();
      await Promise.resolve();

      const displayedPosition = missionAccess.missionPositionsForLiveFrame(0.3)
        .get("agent_0");

      expect(displayedPosition).toEqual([5, 0, 0]);
    } finally {
      requestAnimationFrameSpy.mockRestore();
      cancelAnimationFrameSpy.mockRestore();
    }
  });

  it("refreshes link-count selection diagnostics when the slider changes the selection", () => {
    const triangleTrace: SceneTrace = {
      ...sceneTrace,
      truth: {
        nodes: [
          { id: "agent_0", position_m: [0, 0] },
          { id: "agent_1", position_m: [2, 0] },
          { id: "agent_2", position_m: [0, 2] }
        ]
      },
      measurements: {
        gnss: [],
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
      }
    };
    const root = document.createElement("div");
    const app = createTestApp(root);

    app.mount(triangleTrace);
    const diagnostics = root.querySelector<HTMLElement>(".link-count-diagnostics");
    expect(diagnostics).not.toBeNull();
    expect(diagnostics!.textContent).toContain("3/3 selected");

    const uwbSlider = root.querySelector<HTMLInputElement>(".link-count-control input");
    uwbSlider!.value = "1";
    uwbSlider!.dispatchEvent(new Event("input"));

    expect(diagnostics!.textContent).toContain("1/3 selected");
  });

  it("caps the link-count slider at the active mission drone count", () => {
    const root = document.createElement("div");
    const app = createTestApp(root);

    app.mount(sceneTrace);
    const uwbSlider = root.querySelector<HTMLInputElement>(".link-count-control input");

    expect(uwbSlider!.max).toBe("0");
  });

  it("moves the orbit target and zooms to fit the swarm by default", () => {
    const wideSwarmTrace: SceneTrace = {
      ...sceneTrace,
      truth: {
        nodes: Array.from({ length: 30 }, (_, index) => ({
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
    const root = document.createElement("div");
    const app = createTestApp(root);

    app.mount(wideSwarmTrace);
    const followToggle = root.querySelector<HTMLInputElement>(
      'input[name="cameraFollowsSwarmBarycenter"]'
    );
    expect(followToggle).not.toBeNull();
    expect(followToggle!.checked).toBe(true);
    targetSetMock.mockClear();
    const motion = root.querySelector<HTMLSelectElement>('[name="motion"]');
    expect(motion).not.toBeNull();
    motion!.value = "static";
    motion!.dispatchEvent(new Event("change"));
    const camera = app.getCameraForTest();
    expect(camera).not.toBeNull();

    expect(targetSetMock).toHaveBeenCalledWith(0, 0, 0);
    const followedCameraDistance = Math.hypot(
      camera!.position.x,
      camera!.position.y,
      camera!.position.z
    );
    const defaultCameraDistance = Math.hypot(9, 12, 24);
    expect(followedCameraDistance).toBeGreaterThan(defaultCameraDistance);
  });

  it("preserves the user camera direction while following the barycenter", () => {
    const root = document.createElement("div");
    const app = createTestApp(root);

    app.mount(sceneTrace);
    const camera = app.getCameraForTest();
    expect(camera).not.toBeNull();
    camera!.position.set(-6, 7, 10);
    targetSetMock.mockClear();

    (app as unknown as CameraFollowTestAccess).updateCameraFollowTarget(
      liveFrameFromPositions([["agent_0", [0, 0, 0]]])
    );

    expect(targetSetMock).toHaveBeenCalledWith(0, 0, 0);
    expect(camera!.position.x).toBeLessThan(0);
    expect(camera!.position.y).toBeGreaterThan(0);
    expect(camera!.position.z).toBeGreaterThan(0);
  });

  it("smooths follow zoom changes instead of holding and jumping", () => {
    const root = document.createElement("div");
    const app = createTestApp(root);

    app.mount(sceneTrace);
    const camera = app.getCameraForTest();
    expect(camera).not.toBeNull();
    const cameraFollow = app as unknown as CameraFollowTestAccess;

    cameraFollow.updateCameraFollowTarget(liveFrameWithHorizontalRadius(5));
    const distanceAfterBaselineFrame = cameraDistanceFromFollowTarget(camera!);

    cameraFollow.updateCameraFollowTarget(liveFrameWithHorizontalRadius(5.2));
    const distanceAfterSmallExtentChange = cameraDistanceFromFollowTarget(camera!);

    cameraFollow.updateCameraFollowTarget(liveFrameWithHorizontalRadius(8));
    const distanceAfterLargeExtentChange = cameraDistanceFromFollowTarget(camera!);

    expect(distanceAfterSmallExtentChange).toBeGreaterThan(distanceAfterBaselineFrame);
    expect(distanceAfterSmallExtentChange).toBeLessThan(distanceAfterBaselineFrame * 1.04);
    expect(distanceAfterLargeExtentChange).toBeGreaterThan(distanceAfterSmallExtentChange);
    expect(distanceAfterLargeExtentChange).toBeGreaterThan(
      distanceAfterBaselineFrame * 1.2
    );
    expect(distanceAfterLargeExtentChange).toBeLessThan(
      distanceAfterBaselineFrame * 1.6
    );
  });

  it("keeps a manual zoom distance while following the barycenter", () => {
    const root = document.createElement("div");
    const app = createTestApp(root);

    app.mount(sceneTrace);
    const camera = app.getCameraForTest();
    expect(camera).not.toBeNull();
    camera!.position.set(0, 0, 18);
    const cameraFollow = app as unknown as CameraFollowTestAccess;

    cameraFollow.updateCameraFollowTarget(liveFrameWithHorizontalRadius(8));
    camera!.position.set(0, 0, 11);
    cameraFollow.updateCameraFollowTarget(liveFrameWithHorizontalRadius(8));

    const distanceAfterManualZoom = cameraDistanceFromFollowTarget(camera!);
    expect(distanceAfterManualZoom).toBeCloseTo(11, 6);
  });

  it("lets the follow toggle take charge of zoom again after manual zoom", () => {
    const root = document.createElement("div");
    const app = createTestApp(root);

    app.mount(sceneTrace);
    const camera = app.getCameraForTest();
    expect(camera).not.toBeNull();
    camera!.position.set(0, 0, 18);
    const cameraFollow = app as unknown as CameraFollowTestAccess;

    cameraFollow.updateCameraFollowTarget(liveFrameWithHorizontalRadius(8));
    camera!.position.set(0, 0, 11);
    cameraFollow.updateCameraFollowTarget(liveFrameWithHorizontalRadius(8));
    const distanceAfterManualZoom = cameraDistanceFromFollowTarget(camera!);

    const followToggle = root.querySelector<HTMLInputElement>(
      'input[name="cameraFollowsSwarmBarycenter"]'
    );
    expect(followToggle).not.toBeNull();
    followToggle!.checked = false;
    followToggle!.dispatchEvent(new Event("change"));
    followToggle!.checked = true;
    followToggle!.dispatchEvent(new Event("change"));
    cameraFollow.updateCameraFollowTarget(liveFrameWithHorizontalRadius(8));

    const distanceAfterRetoggle = cameraDistanceFromFollowTarget(camera!);
    expect(distanceAfterRetoggle).toBeGreaterThan(distanceAfterManualZoom);
  });

  it("renders live solver connection status in the side panel", () => {
    const root = document.createElement("div");
    const app = createTestApp(root);

    app.mount(sceneTrace);

    const connectionStatus = root.querySelector<HTMLElement>(".connection-status");
    expect(connectionStatus).not.toBeNull();
    expect(connectionStatus!.textContent).toContain("Live solver:");
  });

  it("does not show the exported trace iteration slider in the live side panel", () => {
    const root = document.createElement("div");
    const app = createTestApp(root);

    app.mount(sceneTrace);

    const sidePanel = root.querySelector<HTMLElement>(".side-panel");
    expect(sidePanel).not.toBeNull();
    expect(sidePanel!.textContent).not.toContain("exported trace iteration");
    expect(sidePanel!.textContent).not.toContain("Inspects exported trace state");
  });

  it("mounts diagnostics plots at the bottom of the main viewport outside the side panel", () => {
    const root = document.createElement("div");
    const app = createTestApp(root);

    app.mount(sceneTrace);

    const viewport = root.querySelector<HTMLElement>(".viewer-viewport");
    const sidePanel = root.querySelector<HTMLElement>(".side-panel");
    const plotBand = root.querySelector<HTMLElement>(".diagnostics-plot-band");

    expect(plotBand).not.toBeNull();
    expect(viewport?.contains(plotBand)).toBe(true);
    expect(sidePanel?.contains(plotBand)).toBe(false);
    expect(plotBand?.style.height).toBe("33.333vh");
    expect(plotBand?.style.width).toBe("100%");
  });

  it("clears diagnostics plot state when the app is destroyed", () => {
    const root = document.createElement("div");
    const app = createTestApp(root);

    app.mount(sceneTrace);
    expect(root.querySelector(".diagnostics-plot-band")).not.toBeNull();

    app.destroy();

    expect(root.querySelector(".diagnostics-plot-band")).toBeNull();
    expect(diagnosticSampleCount(app)).toBe(0);
  });

  it("releases the WebGL renderer when the app is destroyed", () => {
    const root = document.createElement("div");
    const app = createTestApp(root);

    app.mount(sceneTrace);
    app.destroy();

    expect(forceContextLossMock).toHaveBeenCalledTimes(1);
    expect(disposeMock).toHaveBeenCalledTimes(1);
  });

  it("paces frame-loop observability flushes", () => {
    const animationCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        animationCallbacks.push(callback);
        return animationCallbacks.length;
      });
    const cancelAnimationFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
    const performanceFlushes: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      const url = String(input);
      if (url.includes("/observability/performance") && init?.body) {
        performanceFlushes.push(JSON.parse(String(init.body)));
      }
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
    }));
    const root = document.createElement("div");
    const app = createTestApp(root);

    try {
      app.mount(sceneTrace);
      animationCallbacks[0](16);
      animationCallbacks[1](32);
      animationCallbacks[2](48);
    } finally {
      requestAnimationFrameSpy.mockRestore();
      cancelAnimationFrameSpy.mockRestore();
      vi.unstubAllGlobals();
    }

    expect(performanceFlushes).toHaveLength(0);
  });

  it("updates diagnostics plots only when a live solve frame changes", () => {
    const animationCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        animationCallbacks.push(callback);
        return animationCallbacks.length;
      });
    const cancelAnimationFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
    const root = document.createElement("div");
    const app = createTestApp(root);

    try {
      app.mount(sceneTrace);
      animationCallbacks[0](16);
      animationCallbacks[1](32);
      expect(diagnosticSampleCount(app)).toBe(0);

      seedChangedLiveSolveFrame(app);
      animationCallbacks[2](300);
      expect(diagnosticSampleCount(app)).toBe(1);

      animationCallbacks[3](316);
      expect(diagnosticSampleCount(app)).toBe(1);
    } finally {
      requestAnimationFrameSpy.mockRestore();
      cancelAnimationFrameSpy.mockRestore();
    }
  });

  it("resets diagnostics plots for a fresh stream of data", () => {
    const animationCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        animationCallbacks.push(callback);
        return animationCallbacks.length;
      });
    const cancelAnimationFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
    const root = document.createElement("div");
    const app = createTestApp(root);

    try {
      app.mount(sceneTrace);
      seedChangedLiveSolveFrame(app);
      animationCallbacks[0](300);
      expect(diagnosticSampleCount(app)).toBe(1);

      root.querySelector<HTMLButtonElement>(".diagnostics-timeline-reset")?.click();

      expect(diagnosticSampleCount(app)).toBe(0);
      expect(root.querySelector(".diagnostics-timeline-panel")?.textContent)
        .toContain("waiting for live solver data");
    } finally {
      requestAnimationFrameSpy.mockRestore();
      cancelAnimationFrameSpy.mockRestore();
    }
  });

  it("plots raw GNSS baseline error against current truth as an error overlay", () => {
    const root = document.createElement("div");
    const app = createTestApp(root);
    const liveFrame = liveFrameFromPositions([
      ["agent_0", [0, 0, 0]],
      ["agent_1", [3, 0, 0]]
    ]);
    liveFrame.gnssPositions = new Map<string, Position3D>([
      ["agent_0", [0, 5, 0]],
      ["agent_1", [3, 5, 0]]
    ]);
    const displayFrame = {
      schema_version: "0.1.0",
      metadata: { solver: "test", selected_uwb_count: 0 },
      truth: [],
      measurements: { gnss: [], uwb: [] },
      estimates: {
        fused: [
          { agent_id: "agent_0", position_m: [0.1, 0, 0] },
          { agent_id: "agent_1", position_m: [3.1, 0, 0] }
        ],
        gnss_only: []
      },
      trace: {
        trace_type: "live_solve",
        iterations: [{
          iteration: 0,
          positions: {},
          cost_total: 1,
          cost_gnss: 0.5,
          cost_uwb: 0.5,
          gnss_residuals: [],
          uwb_residuals: []
        }]
      },
      constraints: { nodes: [], edges: [] }
    };

    app.mount(sceneTrace);
    (app as unknown as DiagnosticSampleAppendTestAccess)
      .appendDiagnosticSample(1, liveFrame, displayFrame);

    expect(root.querySelector(".diagnostics-timeline-panel")?.textContent)
      .toContain("GNSS 5.000 m");
  });

  it("records response-cadence quality events for displayed live solves", () => {
    const root = document.createElement("div");
    const app = createTestApp(root);
    const liveFrame = liveFrameFromPositions([
      ["agent_0", [0, 0, 0]],
      ["agent_1", [3, 0, 0]]
    ]);
    liveFrame.gnssPositions = new Map<string, Position3D>([
      ["agent_0", [0, 5, 0]],
      ["agent_1", [3, 5, 0]]
    ]);
    const displayFrame = {
      schema_version: "0.1.0",
      metadata: {
        solver: "test",
        selected_uwb_count: 0,
        quality: {
          solve_error: { rmse_m: 0.1, mean_error_m: 0.1, max_error_m: 0.1 },
          gnss_truth_error: { rmse_m: 5, mean_error_m: 5, max_error_m: 5 },
          solve_improvement_rmse_m: 4.9,
          solve_error_ratio_to_gnss: 0.02,
          fused_worse_than_gnss: false,
          final_cost_total: 1,
          final_cost_gnss: 0.5,
          final_cost_uwb: 0.5
        }
      },
      truth: [],
      measurements: { gnss: [], uwb: [] },
      estimates: {
        fused: [
          { agent_id: "agent_0", position_m: [0.1, 0, 0] },
          { agent_id: "agent_1", position_m: [3.1, 0, 0] }
        ],
        gnss_only: []
      },
      trace: {
        trace_type: "live_solve",
        iterations: [{
          iteration: 0,
          positions: {},
          cost_total: 1,
          cost_gnss: 0.5,
          cost_uwb: 0.5,
          gnss_residuals: [],
          uwb_residuals: []
        }]
      },
      constraints: { nodes: [], edges: [] }
    };

    app.mount(sceneTrace);
    const access = app as unknown as DiagnosticSampleAppendTestAccess;
    access.appendDiagnosticSample(1, liveFrame, displayFrame);

    const qualityEvent = access.eventBuffer.snapshot().find((event) => (
      event.event === "live_solve_quality_displayed"
    ));
    expect(qualityEvent?.fields.display_error_rmse_m).toBeCloseTo(0.1);
    expect(qualityEvent?.fields).toMatchObject({
      display_gnss_error_rmse_m: 5,
      solve_error_rmse_m: 0.1,
      gnss_truth_error_rmse_m: 5,
      solve_improvement_rmse_m: 4.9,
      fused_worse_than_gnss: false
    });
  });

  it("does not publish Newton shared state during normal viewer operation", () => {
    const animationCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        animationCallbacks.push(callback);
        return animationCallbacks.length;
      });
    const cancelAnimationFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
    FakeBroadcastChannel.postedMessages = [];
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const root = document.createElement("div");
    const app = createTestApp(root);

    try {
      app.mount(sceneTrace);
      animationCallbacks[0](16);
      animationCallbacks[1](300);
    } finally {
      requestAnimationFrameSpy.mockRestore();
      cancelAnimationFrameSpy.mockRestore();
      vi.unstubAllGlobals();
    }

    expect(FakeBroadcastChannel.postedMessages).toEqual([]);
  });
});

describe("App viewport connection badge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mounts a connection badge inside the 3D viewport", () => {
    const root = document.createElement("div");
    const app = createTestApp(root);

    app.mount(sceneTrace);

    const badge = root.querySelector<HTMLElement>(".viewer-viewport .connection-badge");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("Live solver:");
  });

  it("degrades the badge tone when live solves fail", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/observability/")) {
        return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
      }
      throw new Error("NetworkError when attempting to fetch resource.");
    }));

    const root = document.createElement("div");
    const app = createTestApp(root);
    app.mount(sceneTrace);

    const badge = root.querySelector<HTMLElement>(".viewer-viewport .connection-badge");
    expect(badge).not.toBeNull();

    await vi.waitFor(() => {
      expect(["warning", "bad"]).toContain(badge!.dataset.tone);
      expect(badge!.textContent).toContain("snapshot");
    });
  });
});

describe("App live solve failure observability", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("records the solve endpoint on live solve failure events", async () => {
    const flushedEvents: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const okResponse = {
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({})
    };
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      const url = String(input);
      if (url.includes("/observability/")) {
        if (url.includes("/observability/events") && init?.body) {
          flushedEvents.push(...JSON.parse(String(init.body)));
        }
        return okResponse;
      }
      throw new Error("NetworkError when attempting to fetch resource.");
    }));

    const root = document.createElement("div");
    const app = createTestApp(root);
    app.mount(sceneTrace);

    await vi.waitFor(() => {
      const failedEvent = flushedEvents.find(
        (candidate) => candidate.event === "viewer_live_solve_failed"
      );
      expect(failedEvent).toBeDefined();
      expect(failedEvent!.fields.endpoint).toBe("http://127.0.0.1:8765/live/frame");
    });
  });

  it("records adaptive UWB selection diagnostics on live solve events", async () => {
    const flushedEvents: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const okResponse = {
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({})
    };
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      const url = String(input);
      if (url.includes("/observability/")) {
        if (url.includes("/observability/events") && init?.body) {
          flushedEvents.push(...JSON.parse(String(init.body)));
        }
        return okResponse;
      }
      throw new Error("NetworkError when attempting to fetch resource.");
    }));

    const root = document.createElement("div");
    const app = createTestApp(root);
    app.mount(sceneTrace);

    await vi.waitFor(() => {
      const failedEvent = flushedEvents.find(
        (candidate) => candidate.event === "viewer_live_solve_failed"
      );
      expect(failedEvent).toBeDefined();
      expect(failedEvent!.fields.selection_policy).toBe("adaptive_range_graph_v1");
      expect(failedEvent!.fields.candidate_uwb_links).toBe(0);
      expect(failedEvent!.fields.selected_uwb_links).toBe(0);
      expect(failedEvent!.fields.max_uwb_links_per_agent).toBe(0);
      expect(failedEvent!.fields).not.toHaveProperty("cost_uwb");
    });
  });

  it("records explicit mission-position fallback when backend positions are unavailable", async () => {
    const flushedEvents: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const okResponse = {
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({})
    };
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      const url = String(input);
      if (url.includes("/observability/")) {
        if (url.includes("/observability/events") && init?.body) {
          flushedEvents.push(...JSON.parse(String(init.body)));
        }
        return okResponse;
      }
      throw new Error("NetworkError when attempting to fetch resource.");
    }));

    const root = document.createElement("div");
    const app = createTestApp(root);
    app.mount(sceneTrace);

    await vi.waitFor(() => {
      const failedEvent = flushedEvents.find(
        (candidate) => candidate.event === "viewer_live_solve_failed"
      );
      expect(failedEvent).toBeDefined();
      expect(failedEvent!.fields.mission_position_source).toBe("local_fallback");
    });
  });
});

describe("App backend live-frame path", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function backendLiveFrameBody(): Record<string, unknown> {
    return {
      schema_version: "0.1.0",
      metadata: {
        solver: "c-uwb-gnss",
        formation: "grid",
        motion: "random_walk",
        time_s: 0,
        selected_uwb_count: 1
      },
      truth: [
        { agent_id: "agent_0", position_m: [0, 0, 0] },
        { agent_id: "agent_1", position_m: [2, 0, 0] }
      ],
      measurements: {
        gnss: [
          { agent_id: "agent_0", position_m: [0.2, 0, 0], sigma_m: 1 },
          { agent_id: "agent_1", position_m: [2.2, 0, 0], sigma_m: 1 }
        ],
        uwb: [
          { source_id: "agent_0", target_id: "agent_1", distance_m: 2, sigma_m: 0.1 }
        ]
      },
      selected_uwb_links: [{
        source_id: "agent_0",
        target_id: "agent_1",
        measured_distance_m: 2,
        sigma_m: 0.1,
        selection_reason: "new"
      }],
      uwb_selection: {
        candidate_link_count: 1,
        selected_link_count: 1,
        max_links_per_agent: 3,
        connected_component_count: 1,
        isolated_agent_count: 0,
        triangle_count: 0,
        added_links: 1,
        dropped_links: 0,
        selection_policy: "adaptive_range_graph_v1",
        adaptive_selection_enabled: true
      },
      estimates: {
        fused: [{ agent_id: "agent_0", position_m: [0.1, 0, 0] }],
        gnss_only: [{ agent_id: "agent_0", position_m: [0.2, 0, 0] }]
      },
      trace: {
        trace_type: "live_solve",
        iterations: [{
          iteration: 0,
          positions: { agent_0: [0.1, 0, 0] },
          cost_total: 1,
          cost_gnss: 0.5,
          cost_uwb: 0.5,
          gnss_residuals: [],
          uwb_residuals: []
        }]
      },
      constraints: { nodes: [], edges: [] },
      quality: null
    };
  }

  it("requests /live/frame with mission intent and never assembles a /solve request", async () => {
    const frameRequests: Record<string, unknown>[] = [];
    let solveCalled = false;
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      const url = String(input);
      if (url.endsWith("/solve")) {
        solveCalled = true;
      }
      if (url.includes("/live/frame") && init?.body) {
        frameRequests.push(JSON.parse(String(init.body)));
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => backendLiveFrameBody()
        };
      }
      if (url.includes("/observability/") || url.includes("/mission-actions/")) {
        return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
      }
      throw new Error("NetworkError when attempting to fetch resource.");
    }));

    const root = document.createElement("div");
    const app = createTestApp(root);
    app.mount(sceneTrace);

    await vi.waitFor(() => {
      expect(frameRequests.length).toBeGreaterThan(0);
    });
    const frameRequest = frameRequests[0];
    expect(frameRequest).toHaveProperty("agent_ids");
    expect(frameRequest).toHaveProperty("mission_action");
    expect(frameRequest).toHaveProperty("max_uwb_links_per_agent");
    expect(frameRequest).not.toHaveProperty("agents");
    expect(frameRequest).not.toHaveProperty("gnss");
    expect(frameRequest).not.toHaveProperty("uwb");
    expect(solveCalled).toBe(false);
  });

  it("echoes backend-selected UWB links as the next request's previous links", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/live/frame")) {
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => backendLiveFrameBody()
        };
      }
      if (url.includes("/observability/") || url.includes("/mission-actions/")) {
        return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
      }
      throw new Error("NetworkError when attempting to fetch resource.");
    }));

    const root = document.createElement("div");
    const app = createTestApp(root);
    app.mount(sceneTrace);

    await vi.waitFor(() => {
      const previousLinks = (app as unknown as {
        previousSelectedUwbLinks: Array<{ sourceId: string; targetId: string }>;
      }).previousSelectedUwbLinks;
      expect(previousLinks).toEqual([
        expect.objectContaining({ sourceId: "agent_0", targetId: "agent_1" })
      ]);
    });
  });

  it("marks explicit backend fallback when live frames are unavailable", async () => {
    const flushedEvents: Array<{ event: string; fields: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      const url = String(input);
      if (url.includes("/observability/")) {
        if (url.includes("/observability/events") && init?.body) {
          flushedEvents.push(...JSON.parse(String(init.body)));
        }
        return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
      }
      throw new Error("NetworkError when attempting to fetch resource.");
    }));

    const root = document.createElement("div");
    const app = createTestApp(root);
    app.mount(sceneTrace);

    await vi.waitFor(() => {
      const failedEvent = flushedEvents.find(
        (candidate) => candidate.event === "viewer_live_solve_failed"
      );
      expect(failedEvent).toBeDefined();
      expect(failedEvent!.fields.endpoint).toBe("http://127.0.0.1:8765/live/frame");
      expect(failedEvent!.fields.live_frame_source).toBe("local_fallback");
    });
  });
});
