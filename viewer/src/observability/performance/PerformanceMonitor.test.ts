import { describe, expect, it } from "vitest";

import {
  PerformanceMonitor,
  summarizePerformanceSamples
} from "./PerformanceMonitor";

describe("viewer performance monitor", () => {
  it("records frame samples and classifies slow frames", () => {
    const monitor = new PerformanceMonitor({
      traceId: "trace-viewer",
      slowFrameMs: 33
    });

    monitor.recordFrame("frame-1", 20, { object_count: 10 });
    monitor.recordFrame("frame-2", 40, { object_count: 12 });

    const samples = monitor.samples();
    expect(samples).toHaveLength(2);
    expect(samples[1].is_slow).toBe(true);
    expect(samples[1].fields.object_count).toBe(12);
    expect(samples[1].sample_id).toContain("frame-2");
  });

  it("records live solver latency samples", () => {
    const monitor = new PerformanceMonitor({
      traceId: "trace-viewer",
      slowLiveSolveMs: 250
    });

    monitor.recordLiveSolve("solve-1", 300, { selected_uwb_links: 22 });

    expect(monitor.samples()[0]).toMatchObject({
      metric_name: "live_solve_ms",
      duration_ms: 300,
      is_slow: true
    });
  });

  it("summarizes performance samples with percentiles and slow counts", () => {
    const summary = summarizePerformanceSamples([
      {
        sample_id: "sample-1",
        trace_id: "trace",
        span_id: "frame-1",
        metric_name: "frame_ms",
        component: "viewer",
        duration_ms: 10,
        is_slow: false,
        fields: {}
      },
      {
        sample_id: "sample-2",
        trace_id: "trace",
        span_id: "frame-2",
        metric_name: "frame_ms",
        component: "viewer",
        duration_ms: 40,
        is_slow: true,
        fields: {}
      }
    ]);

    expect(summary.frame_ms.count).toBe(2);
    expect(summary.frame_ms.max).toBe(40);
    expect(summary.frame_ms.slow_count).toBe(1);
  });

  it("teardown clears retained samples", () => {
    const monitor = new PerformanceMonitor({ traceId: "trace-viewer" });

    monitor.recordFrame("frame-1", 20);
    monitor.teardown();

    expect(monitor.samples()).toEqual([]);
  });
});
