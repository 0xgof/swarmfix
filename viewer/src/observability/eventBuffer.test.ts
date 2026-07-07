import { describe, expect, it } from "vitest";

import {
  BrowserEventBuffer,
  createObservationEvent,
  createViewerSession,
  type ObservationEvent
} from "./eventBuffer";

describe("viewer observability event buffer", () => {
  it("creates a session and trace context for one viewer execution", () => {
    const session = createViewerSession({
      component: "viewer",
      scenario: "grid_10_agents",
      mode: "debug"
    });

    expect(session.sessionId).toMatch(/^session-/);
    expect(session.traceId).toMatch(/^trace-/);
    expect(session.mode).toBe("debug");
  });

  it("rejects unsupported logging modes", () => {
    expect(() => createViewerSession({
      component: "viewer",
      scenario: "grid",
      mode: "verbose"
    })).toThrow("logging mode");
  });

  it("buffers events and keeps failed flushes available for retry", async () => {
    const session = createViewerSession({
      component: "viewer",
      scenario: "grid",
      mode: "normal"
    });
    const buffer = new BrowserEventBuffer(10);
    const event = createObservationEvent(session, {
      spanId: "control-1",
      event: "viewer_uwb_graph_changed",
      fields: { max_uwb_links_per_drone: 7 }
    });
    buffer.record(event);

    await expect(buffer.flush(async () => {
      throw new Error("offline");
    })).rejects.toThrow("offline");

    expect(buffer.pendingCount()).toBe(1);
    const flushed: ObservationEvent[][] = [];
    await buffer.flush(async (events) => {
      flushed.push(events);
    });
    expect(buffer.pendingCount()).toBe(0);
    expect(flushed[0][0].session_id).toBe(session.sessionId);
    expect(flushed[0][0].event_id).toContain("control-1");
  });

  it("does not send duplicate payloads for concurrent flush calls", async () => {
    const session = createViewerSession({
      component: "viewer",
      scenario: "grid",
      mode: "normal"
    });
    const buffer = new BrowserEventBuffer(10);
    buffer.record(createObservationEvent(session, {
      spanId: "frame-1",
      event: "viewer_frame_completed"
    }));
    const flushed: ObservationEvent[][] = [];

    await Promise.all([
      buffer.flush(async (events) => {
        flushed.push(events);
      }),
      buffer.flush(async (events) => {
        flushed.push(events);
      })
    ]);

    expect(flushed).toHaveLength(1);
    expect(buffer.pendingCount()).toBe(0);
  });

  it("keeps the newest records when the debug buffer reaches capacity", () => {
    const session = createViewerSession({
      component: "viewer",
      scenario: "grid",
      mode: "debug"
    });
    const buffer = new BrowserEventBuffer(2);

    buffer.record(createObservationEvent(session, { spanId: "frame-1", event: "viewer_frame_completed" }));
    buffer.record(createObservationEvent(session, { spanId: "frame-2", event: "viewer_frame_completed" }));
    buffer.record(createObservationEvent(session, { spanId: "frame-3", event: "viewer_frame_completed" }));

    expect(buffer.snapshot().map((event) => event.span_id)).toEqual(["frame-2", "frame-3"]);
  });
});
