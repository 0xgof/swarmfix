import type { LiveSolverConnectionStatus } from "../live/liveSolverHealthClient";

export interface ConnectionStatusInput {
  status: LiveSolverConnectionStatus;
  endpointUrl: string;
  lastError: string | null;
}

export interface ConnectionStatusModel {
  label: string;
  detail: string;
  tone: "neutral" | "good" | "warning" | "bad";
}

export function buildConnectionStatusModel(input: ConnectionStatusInput): ConnectionStatusModel {
  if (input.status === "connected") {
    const connectedModel = {
      label: "Live solver: connected",
      detail: `Using ${input.endpointUrl}`,
      tone: "good" as const
    };
    return connectedModel;
  }

  if (input.status === "stale") {
    const staleModel = {
      label: "Live solver: stale result",
      detail: input.lastError ?? "Showing the last successful solver response.",
      tone: "warning" as const
    };
    return staleModel;
  }

  if (input.status === "retrying") {
    const retryingModel = {
      label: "Live solver: retrying",
      detail: input.lastError ?? `Waiting for ${input.endpointUrl} to recover.`,
      tone: "warning" as const
    };
    return retryingModel;
  }

  if (input.status === "disconnected") {
    const disconnectedModel = {
      label: "Live solver: disconnected",
      detail: input.lastError ?? `Cannot reach ${input.endpointUrl}`,
      tone: "bad" as const
    };
    return disconnectedModel;
  }

  if (input.status === "checking") {
    const checkingModel = {
      label: "Live solver: checking",
      detail: `Checking ${input.endpointUrl}`,
      tone: "neutral" as const
    };
    return checkingModel;
  }

  const unknownModel = {
    label: "Live solver: unknown",
    detail: `No health response from ${input.endpointUrl} yet.`,
    tone: "neutral" as const
  };
  return unknownModel;
}
