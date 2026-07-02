import { afterEach, describe, expect, it, vi } from "vitest";

import { flushPerformanceSamples } from "./performanceFlush";
import type { PerformanceSample } from "./PerformanceMonitor";

describe("viewer performance flush", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts performance samples to the dev-server endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const samples: PerformanceSample[] = [{
      trace_id: "trace-viewer",
      sample_id: "sample-1",
      span_id: "frame-1",
      metric_name: "frame_ms",
      component: "viewer",
      duration_ms: 40,
      is_slow: true,
      fields: {}
    }];

    await flushPerformanceSamples(samples, "/observability/performance");

    expect(fetchMock).toHaveBeenCalledWith(
      "/observability/performance",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("frame_ms")
      })
    );
  });

  it("raises a clear error when performance sample flush fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "disk offline"
    }));

    await expect(flushPerformanceSamples([], "/observability/performance"))
      .rejects.toThrow("performance flush failed");
  });
});
