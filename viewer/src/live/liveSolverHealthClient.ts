export const defaultLiveSolverHealthEndpoint = "http://127.0.0.1:8765/health";

export interface LiveSolverHealth {
  status: "ok";
  service: "swarmfix-live-solver";
  schema_version: string;
}

export type LiveSolverConnectionStatus =
  | "unknown"
  | "checking"
  | "connected"
  | "disconnected"
  | "retrying"
  | "stale";

export interface LiveSolverConnectionState {
  status: LiveSolverConnectionStatus;
  lastError: string | null;
  lastHealthyAtMs: number | null;
}

export interface ConnectionStateUpdate {
  ok: boolean;
  nowMs: number;
  error?: string | null;
}

function isLiveSolverHealth(payload: unknown): payload is LiveSolverHealth {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const health = payload as Record<string, unknown>;
  const matchesContract = (
    health.status === "ok"
    && health.service === "swarmfix-live-solver"
    && typeof health.schema_version === "string"
  );
  return matchesContract;
}

export async function requestLiveSolverHealth(
    endpointUrl = defaultLiveSolverHealthEndpoint): Promise<LiveSolverHealth> {
  const response = await fetch(endpointUrl, { method: "GET" });
  if (!response.ok) {
    throw new Error(`live solver health failed with ${response.status}`);
  }

  const payload = await response.json();
  if (!isLiveSolverHealth(payload)) {
    throw new Error("malformed live solver health response");
  }
  return payload;
}

export function updateConnectionState(
    state: LiveSolverConnectionState,
    update: ConnectionStateUpdate): LiveSolverConnectionState {
  if (update.ok) {
    const connectedState = {
      status: "connected" as const,
      lastError: null,
      lastHealthyAtMs: update.nowMs
    };
    return connectedState;
  }

  const disconnectedState = {
    status: "disconnected" as const,
    lastError: update.error ?? state.lastError ?? "live solver unavailable",
    lastHealthyAtMs: state.lastHealthyAtMs
  };
  return disconnectedState;
}
