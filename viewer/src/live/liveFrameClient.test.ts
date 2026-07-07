import { afterEach, describe, expect, it, vi } from "vitest";

import type { SceneTrace } from "../data/sceneTypes";
import { defaultLiveFrameEndpoint, requestLiveFrame } from "./liveFrameClient";
import {
  buildLiveFrameRequest,
  deriveLiveFrameSensorOptions,
  liveEstimationFrameFromLiveFrame,
  liveSolveResponseFromLiveFrame,
  type LiveFrameResponse
} from "./liveFrameTypes";

const sceneTrace: SceneTrace = {
  schema_version: "0.1.0",
  metadata: { scenario: "live_frame_client_scene", units: "m", dimension: 2 },
  truth: {
    nodes: [
      { id: "agent_0", position_m: [0, 0] },
      { id: "agent_1", position_m: [4, 0] }
    ]
  },
  measurements: {
    gnss: [
      {
        agent_id: "agent_0",
        position_m: [0.5, 0.2],
        sigma_m: 1.5,
        uncertainty: { type: "isotropic", radius_m: 1.5 }
      }
    ],
    uwb: [
      {
        source_id: "agent_0",
        target_id: "agent_1",
        measured_distance_m: 4,
        sigma_m: 0.25,
        true_distance_m: 4
      }
    ],
    references: []
  },
  estimates: {},
  metrics: {},
  trace: { trace_type: "residual_evaluation", iterations: [] }
};

function backendLiveFrame(): LiveFrameResponse {
  const frame: LiveFrameResponse = {
    schema_version: "0.1.0",
    metadata: {
      solver: "c-uwb-gnss",
      formation: "grid",
      motion: "static",
      time_s: 1,
      selected_uwb_count: 1
    },
    truth: [
      { agent_id: "agent_0", position_m: [0, 0, 0] },
      { agent_id: "agent_1", position_m: [4, 0, 0] }
    ],
    measurements: {
      gnss: [
        { agent_id: "agent_0", position_m: [0.4, 0, 0.1], sigma_m: 1.5 },
        { agent_id: "agent_1", position_m: [4.2, 0, -0.1], sigma_m: 1.0 }
      ],
      uwb: [
        { source_id: "agent_0", target_id: "agent_1", distance_m: 4, sigma_m: 0.25 }
      ]
    },
    selected_uwb_links: [{
      source_id: "agent_0",
      target_id: "agent_1",
      measured_distance_m: 4,
      sigma_m: 0.25,
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
      gnss_only: [{ agent_id: "agent_0", position_m: [0.4, 0, 0.1] }]
    },
    trace: { trace_type: "live_solve", iterations: [] },
    constraints: { nodes: [], edges: [] },
    quality: {
      solve_error: { rmse_m: 0.1, mean_error_m: 0.1, max_error_m: 0.1 },
      gnss_truth_error: { rmse_m: 0.5, mean_error_m: 0.5, max_error_m: 0.5 },
      solve_improvement_rmse_m: 0.4,
      solve_error_ratio_to_gnss: 0.2,
      fused_worse_than_gnss: false
    }
  };
  return frame;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("live frame request building", () => {
  it("carries mission intent, options, and echoed previous links without measurements", () => {
    const request = buildLiveFrameRequest({
      sceneTrace,
      agentIds: ["agent_0", "agent_1"],
      timeSeconds: 2.5,
      missionAction: {
        formation: "ring",
        motion: "static",
        speedMps: 1,
        randomWalkAmplitudeM: 0.24,
        path: "loop",
        previousFormation: null,
        transitionStartedAtS: null,
        transitionDurationS: 2
      },
      maxUwbLinksPerAgent: 4,
      previousSelectedLinks: [{ sourceId: "agent_1", targetId: "agent_0" }]
    });

    expect(request.agent_ids).toEqual(["agent_0", "agent_1"]);
    expect(request.time_s).toBe(2.5);
    expect(request.mission_action.formation).toBe("ring");
    expect(request.max_uwb_links_per_agent).toBe(4);
    expect(request.selection_options.previous_selected_links).toEqual([
      { source_id: "agent_1", target_id: "agent_0" }
    ]);
    expect(request.estimation).toEqual({ max_iterations: 40, robust_loss: "linear" });
    expect(request).not.toHaveProperty("gnss");
    expect(request).not.toHaveProperty("uwb");
    expect(request).not.toHaveProperty("agents");
  });

  it("echoes the previous fused estimate as selection geometry, never truth", () => {
    const request = buildLiveFrameRequest({
      sceneTrace,
      agentIds: ["agent_0", "agent_1"],
      timeSeconds: 1,
      missionAction: {
        formation: "grid",
        motion: "static",
        speedMps: 1,
        randomWalkAmplitudeM: 0.24,
        path: "loop",
        previousFormation: null,
        transitionStartedAtS: null,
        transitionDurationS: 2
      },
      maxUwbLinksPerAgent: 3,
      previousSelectedLinks: [],
      previousEstimate: [
        { agent_id: "agent_0", position_m: [0.1, 0, 0] },
        { agent_id: "agent_1", position_m: [4.1, 0, 0] }
      ]
    });

    expect(request.selection_options.previous_estimate).toEqual([
      { agent_id: "agent_0", position_m: [0.1, 0, 0] },
      { agent_id: "agent_1", position_m: [4.1, 0, 0] }
    ]);
  });

  it("defaults previous estimate to empty so the backend falls back to GNSS", () => {
    const request = buildLiveFrameRequest({
      sceneTrace,
      agentIds: ["agent_0"],
      timeSeconds: 0,
      missionAction: {
        formation: "grid",
        motion: "static",
        speedMps: 1,
        randomWalkAmplitudeM: 0.24,
        path: "loop",
        previousFormation: null,
        transitionStartedAtS: null,
        transitionDurationS: 2
      },
      maxUwbLinksPerAgent: 3,
      previousSelectedLinks: [],
      previousEstimate: []
    });

    expect(request.selection_options.previous_estimate).toEqual([]);
  });

  it("derives scene-based GNSS offsets and sigma fallbacks as sensor options", () => {
    const sensorOptions = deriveLiveFrameSensorOptions(sceneTrace);

    expect(sensorOptions.gnss_offset_m_by_agent.agent_0).toEqual([0.5, 0, 0.2]);
    expect(sensorOptions.gnss_sigma_m_by_agent.agent_0).toBe(1.5);
    expect(sensorOptions.uwb_sigma_m_by_link["agent_0::agent_1"]).toBe(0.25);
    expect(sensorOptions.gnss_fallback_sigma_m).toBe(1.5);
    expect(sensorOptions.uwb_fallback_sigma_m).toBe(0.25);
  });

  it("uses documented fallback sigmas when the scene has no measurements", () => {
    const emptyScene: SceneTrace = {
      ...sceneTrace,
      measurements: { gnss: [], uwb: [], references: [] }
    };

    const sensorOptions = deriveLiveFrameSensorOptions(emptyScene);

    expect(sensorOptions.gnss_fallback_sigma_m).toBe(1.0);
    expect(sensorOptions.uwb_fallback_sigma_m).toBe(0.1);
  });
});

describe("live frame response conversion", () => {
  it("converts a backend frame into the render frame shape", () => {
    const frame = backendLiveFrame();

    const renderFrame = liveEstimationFrameFromLiveFrame(frame);

    expect(renderFrame.truthPositions.get("agent_1")).toEqual([4, 0, 0]);
    expect(renderFrame.gnssPositions.get("agent_0")).toEqual([0.4, 0, 0.1]);
    expect(renderFrame.gnssSigma.get("agent_1")).toBe(1.0);
    expect(renderFrame.uwbLinks).toEqual([{
      sourceId: "agent_0",
      targetId: "agent_1",
      measuredDistanceM: 4,
      sigmaM: 0.25,
      selectionReason: "new"
    }]);
    expect(renderFrame.uwbSelection.selectedLinkCount).toBe(1);
  });

  it("prefers display-cadence truth positions for known agents", () => {
    const frame = backendLiveFrame();
    const displayPositions = new Map<string, [number, number, number]>([
      ["agent_0", [0.9, 0, 0]],
      ["agent_unknown", [99, 0, 0]]
    ]);

    const renderFrame = liveEstimationFrameFromLiveFrame(frame, displayPositions);

    expect(renderFrame.truthPositions.get("agent_0")).toEqual([0.9, 0, 0]);
    expect(renderFrame.truthPositions.get("agent_1")).toEqual([4, 0, 0]);
    expect(renderFrame.truthPositions.has("agent_unknown")).toBe(false);
  });

  it("adapts a backend frame into the live solve response shape with quality", () => {
    const frame = backendLiveFrame();

    const response = liveSolveResponseFromLiveFrame(frame);

    expect(response.metadata.solver).toBe("c-uwb-gnss");
    expect(response.metadata.selected_uwb_count).toBe(1);
    expect(response.metadata.quality?.solve_error.rmse_m).toBe(0.1);
    expect(response.estimates.fused).toHaveLength(1);
  });
});

describe("live frame client", () => {
  it("posts the request to the live frame endpoint and validates the response", async () => {
    let requestedUrl = "";
    let requestBody: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      requestedUrl = String(input);
      requestBody = JSON.parse(String(init?.body));
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => backendLiveFrame()
      };
    }));
    const request = buildLiveFrameRequest({
      sceneTrace,
      agentIds: ["agent_0", "agent_1"],
      timeSeconds: 0,
      missionAction: {
        formation: "grid",
        motion: "static",
        speedMps: 1,
        randomWalkAmplitudeM: 0.24,
        path: "loop",
        previousFormation: null,
        transitionStartedAtS: null,
        transitionDurationS: 2
      },
      maxUwbLinksPerAgent: 3,
      previousSelectedLinks: []
    });

    const response = await requestLiveFrame(request);

    expect(requestedUrl).toBe(defaultLiveFrameEndpoint);
    expect(requestBody).toMatchObject({ agent_ids: ["agent_0", "agent_1"] });
    expect(response.selected_uwb_links).toHaveLength(1);
  });

  it("rejects malformed frame payloads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({ estimates: { fused: [] } })
    })));

    await expect(requestLiveFrame(buildLiveFrameRequest({
      sceneTrace,
      agentIds: ["agent_0"],
      timeSeconds: 0,
      missionAction: {
        formation: "grid",
        motion: "static",
        speedMps: 1,
        randomWalkAmplitudeM: 0.24,
        path: "loop",
        previousFormation: null,
        transitionStartedAtS: null,
        transitionDurationS: 2
      },
      maxUwbLinksPerAgent: 3,
      previousSelectedLinks: []
    }))).rejects.toThrow("selected UWB links");
  });

  it("throws with status detail when the backend rejects the request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => "agent_ids must not be empty",
      json: async () => ({})
    })));

    await expect(requestLiveFrame(buildLiveFrameRequest({
      sceneTrace,
      agentIds: ["agent_0"],
      timeSeconds: 0,
      missionAction: {
        formation: "grid",
        motion: "static",
        speedMps: 1,
        randomWalkAmplitudeM: 0.24,
        path: "loop",
        previousFormation: null,
        transitionStartedAtS: null,
        transitionDurationS: 2
      },
      maxUwbLinksPerAgent: 3,
      previousSelectedLinks: []
    }))).rejects.toThrow("400");
  });
});
