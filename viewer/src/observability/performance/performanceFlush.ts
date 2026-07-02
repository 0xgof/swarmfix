import type { PerformanceSample } from "./PerformanceMonitor";

export async function flushPerformanceSamples(samples: PerformanceSample[],
                                              endpointUrl: string): Promise<void> {
  const response = await fetch(endpointUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(samples)
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `performance flush failed with ${response.status}: ${errorText}`
    );
  }
}
