import type { LiveSolveRequest, LiveSolveResponse } from "./liveSolveTypes";

export const defaultLiveSolveEndpoint = "http://127.0.0.1:8765/solve";

function validateLiveSolveResponse(payload: unknown): LiveSolveResponse {
  if (!payload || typeof payload !== "object") {
    throw new Error("live solver response is not an object");
  }

  const response = payload as LiveSolveResponse;
  if (!response.estimates || !Array.isArray(response.estimates.fused)) {
    throw new Error("live solver response is missing fused estimates");
  }
  if (!response.constraints || !Array.isArray(response.constraints.nodes)) {
    throw new Error("live solver response is missing UWB constraints");
  }
  return response;
}

export async function requestLiveSolve(request: LiveSolveRequest,
                                       endpointUrl = defaultLiveSolveEndpoint): Promise<LiveSolveResponse> {
  const solveResponse = await fetch(endpointUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });

  if (!solveResponse.ok) {
    const errorText = await solveResponse.text();
    throw new Error(
      `live solver request failed with ${solveResponse.status}: ${errorText}`
    );
  }

  const payload = await solveResponse.json();
  const validatedResponse = validateLiveSolveResponse(payload);
  return validatedResponse;
}
