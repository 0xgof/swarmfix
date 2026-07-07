import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BrowserEventBuffer,
  createObservationEvent,
  createViewerSession
} from "./eventBuffer";
import { flushObservationEvents } from "./eventFlush";

describe("viewer observability flush", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("flushes buffered events to the dev-server endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const session = createViewerSession({
      component: "viewer",
      scenario: "grid",
      mode: "normal"
    });
    const buffer = new BrowserEventBuffer();
    buffer.record(createObservationEvent(session, {
      spanId: "viewer-start",
      event: "viewer_session_started"
    }));

    await flushObservationEvents(buffer, "/observability/events");

    expect(buffer.pendingCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "/observability/events",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("viewer_session_started")
      })
    );
  });

  it("keeps unsent records when endpoint flush fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "disk offline"
    }));
    const session = createViewerSession({
      component: "viewer",
      scenario: "grid",
      mode: "normal"
    });
    const buffer = new BrowserEventBuffer();
    buffer.record(createObservationEvent(session, {
      spanId: "control-1",
      event: "viewer_uwb_graph_changed"
    }));

    await expect(flushObservationEvents(buffer, "/observability/events"))
      .rejects.toThrow("observability flush failed");

    expect(buffer.pendingCount()).toBe(1);
  });
});
