import { afterEach, describe, expect, it, vi } from "vitest";

import { requestLiveSolve } from "./liveSolverClient";
import type { LiveSolveRequest, LiveSolveResponse } from "./liveSolveTypes";

const request: LiveSolveRequest = {
  schema_version: "0.1.0",
  dimension: 3,
  agents: [{ agent_id: "a", position_m: [0, 0, 0] }],
  gnss: [{ agent_id: "a", position_m: [0.1, 0, 0], sigma_m: 1 }],
  uwb: [],
  selected_uwb_links: [],
  estimation: { max_iterations: 20, robust_loss: "linear" }
};

const response: LiveSolveResponse = {
  schema_version: "0.1.0",
  metadata: { solver: "python-least-squares", selected_uwb_count: 0 },
  truth: [{ agent_id: "a", position_m: [0, 0, 0] }],
  measurements: { gnss: [], uwb: [] },
  estimates: {
    fused: [{ agent_id: "a", position_m: [0.05, 0, 0] }],
    gnss_only: [{ agent_id: "a", position_m: [0.1, 0, 0] }]
  },
  trace: { trace_type: "residual_evaluation", iterations: [] },
  constraints: {
    nodes: [{ agent_id: "a", selected_uwb_degree: 0, constraint_state: "no_uwb" }],
    edges: []
  }
};

describe("live solver client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts live solve requests to the Python endpoint and returns the typed response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => response
    });
    vi.stubGlobal("fetch", fetchMock);

    const liveResponse = await requestLiveSolve(request, "http://solver.local/solve");

    expect(liveResponse.estimates.fused[0].position_m).toEqual([0.05, 0, 0]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://solver.local/solve",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(request)
      })
    );
  });

  it("rejects failed solver responses instead of falling back to browser fusion", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "bad live solve"
    }));

    await expect(requestLiveSolve(request, "http://solver.local/solve"))
      .rejects.toThrow("live solver request failed");
  });

  it("rejects malformed responses that do not contain fused estimates", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ schema_version: "0.1.0" })
    }));

    await expect(requestLiveSolve(request, "http://solver.local/solve"))
      .rejects.toThrow("live solver response is missing fused estimates");
  });
});
