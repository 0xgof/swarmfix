import { afterEach, describe, expect, it, vi } from "vitest";

import {
  requestLiveSolverHealth,
  updateConnectionState,
  type LiveSolverConnectionState
} from "./liveSolverHealthClient";

describe("live solver health client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns connected state for a healthy Python backend", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "ok",
        service: "swarmfix-live-solver",
        schema_version: "0.1.0"
      })
    }));

    const health = await requestLiveSolverHealth("http://solver.local/health");

    expect(health.status).toBe("ok");
    expect(health.service).toBe("swarmfix-live-solver");
  });

  it("rejects malformed health responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok" })
    }));

    await expect(requestLiveSolverHealth("http://solver.local/health"))
      .rejects.toThrow("malformed live solver health response");
  });

  it("transitions connection state after health success and failure", () => {
    const unknown: LiveSolverConnectionState = {
      status: "unknown",
      lastError: null,
      lastHealthyAtMs: null
    };

    const connected = updateConnectionState(unknown, {
      ok: true,
      nowMs: 100
    });
    const disconnected = updateConnectionState(connected, {
      ok: false,
      nowMs: 200,
      error: "Failed to fetch"
    });

    expect(connected.status).toBe("connected");
    expect(connected.lastHealthyAtMs).toBe(100);
    expect(disconnected.status).toBe("disconnected");
    expect(disconnected.lastError).toBe("Failed to fetch");
  });
});
