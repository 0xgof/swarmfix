import { describe, expect, it } from "vitest";

import { buildConnectionStatusModel } from "./ConnectionStatusPanel";

describe("connection status panel model", () => {
  it("formats connected live solver status compactly", () => {
    const model = buildConnectionStatusModel({
      status: "connected",
      endpointUrl: "http://127.0.0.1:8765",
      lastError: null
    });

    expect(model.label).toBe("Live solver: connected");
    expect(model.detail).toContain("127.0.0.1:8765");
  });

  it("formats disconnected and stale states with the last error", () => {
    const disconnected = buildConnectionStatusModel({
      status: "disconnected",
      endpointUrl: "http://127.0.0.1:8765",
      lastError: "Failed to fetch"
    });
    const stale = buildConnectionStatusModel({
      status: "stale",
      endpointUrl: "http://127.0.0.1:8765",
      lastError: "solver offline"
    });

    expect(disconnected.label).toBe("Live solver: disconnected");
    expect(disconnected.detail).toContain("Failed to fetch");
    expect(stale.label).toBe("Live solver: stale result");
  });
});
