import { describe, expect, it } from "vitest";

import {
  createViewportConnectionBadge,
  updateViewportConnectionBadge
} from "./ViewportConnectionBadge";

describe("viewport connection badge", () => {
  it("shows a connected solver with a good tone and no snapshot warning", () => {
    const badge = createViewportConnectionBadge({
      status: "connected",
      endpointUrl: "http://127.0.0.1:8765/health",
      lastError: null
    });

    expect(badge.className).toBe("connection-badge");
    expect(badge.dataset.tone).toBe("good");
    expect(badge.textContent).toContain("Live solver: connected");
    expect(badge.textContent).not.toContain("snapshot");
  });

  it("marks retrying, stale, and disconnected states as stale snapshots", () => {
    const retrying = createViewportConnectionBadge({
      status: "retrying",
      endpointUrl: "http://127.0.0.1:8765/health",
      lastError: "NetworkError"
    });
    const stale = createViewportConnectionBadge({
      status: "stale",
      endpointUrl: "http://127.0.0.1:8765/health",
      lastError: null
    });
    const disconnected = createViewportConnectionBadge({
      status: "disconnected",
      endpointUrl: "http://127.0.0.1:8765/health",
      lastError: "NetworkError"
    });

    expect(retrying.dataset.tone).toBe("warning");
    expect(stale.dataset.tone).toBe("warning");
    expect(disconnected.dataset.tone).toBe("bad");
    for (const badge of [retrying, stale, disconnected]) {
      expect(badge.textContent).toContain("snapshot");
    }
  });

  it("updates in place when the connection status changes", () => {
    const badge = createViewportConnectionBadge({
      status: "unknown",
      endpointUrl: "http://127.0.0.1:8765/health",
      lastError: null
    });
    expect(badge.dataset.tone).toBe("neutral");

    updateViewportConnectionBadge(badge, {
      status: "connected",
      endpointUrl: "http://127.0.0.1:8765/health",
      lastError: null
    });

    expect(badge.dataset.tone).toBe("good");
    expect(badge.textContent).toContain("Live solver: connected");
    expect(badge.textContent).not.toContain("snapshot");
  });
});
