import type { BrowserEventBuffer, ObservationEvent } from "./eventBuffer";

export async function flushObservationEvents(buffer: BrowserEventBuffer,
                                             endpointUrl: string): Promise<void> {
  await buffer.flush(async (events: ObservationEvent[]) => {
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(events)
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `observability flush failed with ${response.status}: ${errorText}`
      );
    }
  });
}
