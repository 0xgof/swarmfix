import type {
  LiveSolveRequest,
  LiveSolveResponse,
  SelectedUwbLink
} from "../live/liveSolveTypes";
import type { MissionActionState } from "../simulation/missionActions";

export const NEWTON_SHARED_STATE_CHANNEL = "swarmfix-newton-shared-state";
export const NEWTON_DIAGNOSTICS_STORAGE_KEY = "swarmfix:newton-diagnostics";

export interface NewtonSharedState {
  schemaVersion: string;
  timestampMs: number;
  missionAction: MissionActionState | null;
  liveFrame?: unknown;
  liveSolveRequest: LiveSolveRequest | null;
  liveSolveResponse: LiveSolveResponse | null;
  selectedUwbLinks: SelectedUwbLink[];
  solverBackend: string | null;
}

export type NewtonSharedStateListener = (state: NewtonSharedState) => void;
export type NewtonSharedStateUnsubscribe = () => void;

function canUseBroadcastChannel(): boolean {
  return typeof BroadcastChannel !== "undefined";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isNewtonSharedState(value: unknown): value is NewtonSharedState {
  if (!isRecord(value)) {
    return false;
  }
  const hasStateShape = (
    typeof value.schemaVersion === "string"
    && typeof value.timestampMs === "number"
    && Array.isArray(value.selectedUwbLinks)
    && "liveSolveRequest" in value
    && "liveSolveResponse" in value
  );
  return hasStateShape;
}

export function publishNewtonSharedState(state: NewtonSharedState): void {
  if (!canUseBroadcastChannel()) {
    return;
  }
  const channel = new BroadcastChannel(NEWTON_SHARED_STATE_CHANNEL);
  channel.postMessage(state);
  channel.close();
}

export function subscribeNewtonSharedState(
  listener: NewtonSharedStateListener
): NewtonSharedStateUnsubscribe {
  if (!canUseBroadcastChannel()) {
    return () => undefined;
  }
  const channel = new BroadcastChannel(NEWTON_SHARED_STATE_CHANNEL);
  channel.onmessage = (event: MessageEvent) => {
    if (isNewtonSharedState(event.data)) {
      listener(event.data);
    }
  };
  return () => channel.close();
}
