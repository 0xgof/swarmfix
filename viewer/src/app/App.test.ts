import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SceneTrace } from "../data/sceneTypes";

const renderMock = vi.fn();
const setSizeMock = vi.fn();
const disposeMock = vi.fn();
const forceContextLossMock = vi.fn();
const setPixelRatioMock = vi.fn();
const updateMock = vi.fn();
const controlsDisposeMock = vi.fn();
const addEventListenerMock = vi.fn();

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
      set: vi.fn()
    };
    update = updateMock;
    dispose = controlsDisposeMock;
  }
}));

import { App } from "./App";

const mountedApps: App[] = [];

function createTestApp(root: HTMLElement): App {
  const app = new App(root);
  mountedApps.push(app);
  return app;
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

  it("caps the link-count slider at the number of unique peers in the scene", () => {
    const root = document.createElement("div");
    const app = createTestApp(root);

    app.mount(sceneTrace);
    const uwbSlider = root.querySelector<HTMLInputElement>(".link-count-control input");

    expect(uwbSlider!.max).toBe("1");
  });

  it("renders live solver connection status in the side panel", () => {
    const root = document.createElement("div");
    const app = createTestApp(root);

    app.mount(sceneTrace);

    const connectionStatus = root.querySelector<HTMLElement>(".connection-status");
    expect(connectionStatus).not.toBeNull();
    expect(connectionStatus!.textContent).toContain("Live solver:");
  });

  it("releases the WebGL renderer when the app is destroyed", () => {
    const root = document.createElement("div");
    const app = createTestApp(root);

    app.mount(sceneTrace);
    app.destroy();

    expect(forceContextLossMock).toHaveBeenCalledTimes(1);
    expect(disposeMock).toHaveBeenCalledTimes(1);
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
      expect(failedEvent!.fields.endpoint).toBe("http://127.0.0.1:8765/solve");
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
      expect(failedEvent!.fields.max_uwb_links_per_agent).toBe(1);
      expect(failedEvent!.fields).not.toHaveProperty("cost_uwb");
    });
  });
});
