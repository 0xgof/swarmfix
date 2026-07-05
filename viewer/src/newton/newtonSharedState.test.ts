import { describe, expect, it, vi } from "vitest";

import {
  NEWTON_SHARED_STATE_CHANNEL,
  subscribeNewtonSharedState,
  publishNewtonSharedState,
  type NewtonSharedState
} from "./newtonSharedState";

class FakeBroadcastChannel {
  static latest: FakeBroadcastChannel | null = null;

  name: string;
  postedMessages: unknown[];
  onmessage: ((event: MessageEvent) => void) | null;
  closed: boolean;

  constructor(name: string) {
    this.name = name;
    this.postedMessages = [];
    this.onmessage = null;
    this.closed = false;
    FakeBroadcastChannel.latest = this;
  }

  postMessage(message: unknown): void {
    this.postedMessages.push(message);
  }

  close(): void {
    this.closed = true;
  }
}

const state: NewtonSharedState = {
  schemaVersion: "0.1.0",
  timestampMs: 10,
  missionAction: null,
  liveSolveRequest: null,
  liveSolveResponse: null,
  selectedUwbLinks: [],
  solverBackend: "fixture"
};

describe("newton shared state", () => {
  it("publishes compact state on the Newton channel", () => {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);

    publishNewtonSharedState(state);

    expect(FakeBroadcastChannel.latest?.name).toBe(NEWTON_SHARED_STATE_CHANNEL);
    expect(FakeBroadcastChannel.latest?.postedMessages).toEqual([state]);
    vi.unstubAllGlobals();
  });

  it("subscribes to valid shared-state messages and ignores malformed values", () => {
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const received: NewtonSharedState[] = [];

    const unsubscribe = subscribeNewtonSharedState((nextState) => {
      received.push(nextState);
    });
    FakeBroadcastChannel.latest?.onmessage?.({ data: { nope: true } } as MessageEvent);
    FakeBroadcastChannel.latest?.onmessage?.({ data: state } as MessageEvent);

    expect(received).toEqual([state]);
    unsubscribe();
    expect(FakeBroadcastChannel.latest?.closed).toBe(true);
    vi.unstubAllGlobals();
  });
});
