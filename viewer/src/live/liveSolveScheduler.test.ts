import { describe, expect, it, vi } from "vitest";

import { LiveSolveScheduler } from "./liveSolveScheduler";
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

function responseWithFusedPosition(x: number): LiveSolveResponse {
  const movedResponse = {
    ...response,
    estimates: {
      fused: [{ agent_id: "a", position_m: [x, 0, 0] }],
      gnss_only: [{ agent_id: "a", position_m: [x + 0.1, 0, 0] }]
    }
  };
  return movedResponse;
}

describe("live solve scheduler", () => {
  it("keeps the last authoritative solver frame available for rendering", async () => {
    const solve = vi.fn().mockResolvedValue(response);
    const scheduler = new LiveSolveScheduler(solve, 100);

    await scheduler.requestNow(request);

    expect(scheduler.getLatestSolvedFrame()).toBe(response);
    expect(scheduler.getStatus()).toBe("ready");
    expect(solve).toHaveBeenCalledWith(request);
  });

  it("reports when a new solver frame has arrived since the last UI refresh", async () => {
    const solve = vi.fn().mockResolvedValue(response);
    const scheduler = new LiveSolveScheduler(solve, 100);

    expect(scheduler.consumeFrameChanged()).toBe(false);
    await scheduler.requestNow(request);

    expect(scheduler.consumeFrameChanged()).toBe(true);
    expect(scheduler.consumeFrameChanged()).toBe(false);
  });

  it("starts with an exported authoritative solver frame before the live service replies", () => {
    const solve = vi.fn().mockResolvedValue(response);
    const scheduler = new LiveSolveScheduler(solve, 100, response);

    expect(scheduler.getLatestSolvedFrame()).toBe(response);
    expect(scheduler.getStatus()).toBe("ready");
  });

  it("interpolates display positions between authoritative solver responses", async () => {
    let nowMs = 0;
    const firstResponse = responseWithFusedPosition(0);
    const secondResponse = responseWithFusedPosition(10);
    const solve = vi.fn()
      .mockResolvedValueOnce(firstResponse)
      .mockResolvedValueOnce(secondResponse);
    const scheduler = new LiveSolveScheduler(solve, 100, null, {
      clock: () => nowMs,
      displayTransitionMs: 100
    });

    await scheduler.requestNow(request);
    nowMs = 1000;
    await scheduler.requestNow(request);

    expect(scheduler.getLatestSolvedFrame()).toBe(secondResponse);
    expect(scheduler.getDisplayFrame(1000)?.estimates.fused[0].position_m)
      .toEqual([0, 0, 0]);
    expect(scheduler.getDisplayFrame(1050)?.estimates.fused[0].position_m)
      .toEqual([5, 0, 0]);
    expect(scheduler.getDisplayFrame(1100)?.estimates.fused[0].position_m)
      .toEqual([10, 0, 0]);
  });

  it("throttles automatic live solves so menu changes do not reset camera state", async () => {
    const solve = vi.fn().mockResolvedValue(response);
    const scheduler = new LiveSolveScheduler(solve, 100);

    await scheduler.tick(0, () => request);
    await scheduler.tick(50, () => request);
    await scheduler.tick(101, () => request);

    expect(solve).toHaveBeenCalledTimes(2);
  });

  it("keeps stale solver data visible when a later request fails", async () => {
    const solve = vi.fn()
      .mockResolvedValueOnce(response)
      .mockRejectedValueOnce(new Error("solver offline"));
    const scheduler = new LiveSolveScheduler(solve, 0);

    await scheduler.requestNow(request);
    await scheduler.requestNow(request);

    expect(scheduler.getLatestSolvedFrame()).toBe(response);
    expect(scheduler.getStatus()).toBe("stale");
    expect(scheduler.getError()).toBe("solver offline");
  });

  it("opens a circuit after repeated failures and pauses solve requests", async () => {
    const solve = vi.fn().mockRejectedValue(new Error("solver offline"));
    const health = vi.fn().mockRejectedValue(new Error("still offline"));
    const scheduler = new LiveSolveScheduler(solve, 0, response, {
      failureThreshold: 2,
      circuitBackoffMs: 1000,
      healthCheck: health
    });

    await scheduler.requestNow(request);
    await scheduler.requestNow(request);
    await scheduler.tick(100, () => request);

    expect(scheduler.getStatus()).toBe("retrying");
    expect(solve).toHaveBeenCalledTimes(2);
    expect(health).toHaveBeenCalledTimes(0);
  });

  it("does not start a second health probe while one is in flight", async () => {
    const solve = vi.fn().mockRejectedValue(new Error("offline"));
    const probeRejects: Array<(error: Error) => void> = [];
    const health = vi.fn(() => new Promise<void>((_, reject) => {
      probeRejects.push(reject);
    }));
    const scheduler = new LiveSolveScheduler(solve, 0, response, {
      failureThreshold: 1,
      circuitBackoffMs: 100,
      healthCheck: health
    });

    await scheduler.requestNow(request);
    expect(scheduler.getStatus()).toBe("retrying");

    const slowProbeTick = scheduler.tick(200, () => request);
    await scheduler.tick(216, () => request);
    await scheduler.tick(233, () => request);

    expect(health).toHaveBeenCalledTimes(1);

    probeRejects[0](new Error("still offline"));
    await slowProbeTick;
  });

  it("paces failed health probes from probe completion, not probe start", async () => {
    const solve = vi.fn().mockRejectedValue(new Error("offline"));
    const probeRejects: Array<(error: Error) => void> = [];
    const health = vi.fn(() => new Promise<void>((_, reject) => {
      probeRejects.push(reject);
    }));
    const scheduler = new LiveSolveScheduler(solve, 0, response, {
      failureThreshold: 1,
      circuitBackoffMs: 100,
      healthCheck: health
    });

    await scheduler.requestNow(request);
    const slowProbeTick = scheduler.tick(200, () => request);
    await scheduler.tick(400, () => request);
    probeRejects[0](new Error("still offline"));
    await slowProbeTick;

    await scheduler.tick(450, () => request);
    expect(health).toHaveBeenCalledTimes(1);

    const nextProbeTick = scheduler.tick(510, () => request);
    expect(health).toHaveBeenCalledTimes(2);
    probeRejects[1](new Error("still offline"));
    await nextProbeTick;
  });

  it("closes the circuit when an in-flight probe succeeds and resumes solving", async () => {
    const solve = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(response);
    let resolveProbe: () => void = () => undefined;
    const health = vi.fn(() => new Promise<void>((resolve) => {
      resolveProbe = resolve;
    }));
    const scheduler = new LiveSolveScheduler(solve, 0, response, {
      failureThreshold: 1,
      circuitBackoffMs: 100,
      healthCheck: health
    });

    await scheduler.requestNow(request);
    const slowProbeTick = scheduler.tick(200, () => request);
    await scheduler.tick(216, () => request);
    resolveProbe();
    await slowProbeTick;

    expect(health).toHaveBeenCalledTimes(1);
    expect(scheduler.getStatus()).toBe("ready");
    expect(solve).toHaveBeenCalledTimes(2);
  });

  it("closes an open circuit after health recovers and resumes solving", async () => {
    const solve = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(response);
    const health = vi.fn().mockResolvedValue(undefined);
    const scheduler = new LiveSolveScheduler(solve, 0, response, {
      failureThreshold: 2,
      circuitBackoffMs: 100,
      healthCheck: health
    });

    await scheduler.requestNow(request);
    await scheduler.requestNow(request);
    await scheduler.tick(150, () => request);

    expect(health).toHaveBeenCalledTimes(1);
    expect(solve).toHaveBeenCalledTimes(3);
    expect(scheduler.getStatus()).toBe("ready");
  });
});
