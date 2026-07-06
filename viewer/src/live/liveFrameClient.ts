/**
 * HTTP client for the backend-owned live frame endpoint (BLF-005).
 *
 * `POST /live/frame` is the normal-path boundary: the viewer sends mission
 * intent and options, the backend builds measurements, selects UWB links,
 * solves, and returns the render-ready frame. The lower-level `/solve`
 * client stays available for diagnostics and tests.
 */

import type { LiveFrameRequest, LiveFrameResponse } from "./liveFrameTypes";

export const defaultLiveFrameEndpoint = "http://127.0.0.1:8765/live/frame";

function validateLiveFrameResponse(payload: unknown): LiveFrameResponse {
  if (!payload || typeof payload !== "object") {
    throw new Error("live frame response is not an object");
  }

  const response = payload as LiveFrameResponse;
  if (!response.estimates || !Array.isArray(response.estimates.fused)) {
    throw new Error("live frame response is missing fused estimates");
  }
  if (!Array.isArray(response.selected_uwb_links)) {
    throw new Error("live frame response is missing selected UWB links");
  }
  if (!response.uwb_selection || typeof response.uwb_selection !== "object") {
    throw new Error("live frame response is missing UWB selection diagnostics");
  }
  if (!response.measurements || !Array.isArray(response.measurements.gnss)) {
    throw new Error("live frame response is missing GNSS measurements");
  }
  return response;
}

export async function requestLiveFrame(request: LiveFrameRequest,
                                       endpointUrl = defaultLiveFrameEndpoint): Promise<LiveFrameResponse> {
  const frameResponse = await fetch(endpointUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });

  if (!frameResponse.ok) {
    const errorText = await frameResponse.text();
    throw new Error(
      `live frame request failed with ${frameResponse.status}: ${errorText}`
    );
  }

  const payload = await frameResponse.json();
  const validatedResponse = validateLiveFrameResponse(payload);
  return validatedResponse;
}
