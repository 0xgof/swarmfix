import type { LiveSolveRequest, LiveSolveResponse } from "./liveSolveTypes";
import { interpolateLiveSolveResponse } from "./liveSolveInterpolation";

export type LiveSolveStatus = "idle" | "solving" | "ready" | "stale" | "retrying";
export type LiveSolveClient<TRequest = LiveSolveRequest> =
  (request: TRequest) => Promise<LiveSolveResponse>;
export type LiveSolveHealthCheck = () => Promise<void>;
export type LiveSolveClock = () => number;

export interface LiveSolveSchedulerOptions {
  failureThreshold?: number;
  circuitBackoffMs?: number;
  healthCheck?: LiveSolveHealthCheck;
  clock?: LiveSolveClock;
  displayTransitionMs?: number;
}

export class LiveSolveScheduler<TRequest = LiveSolveRequest> {
  private client: LiveSolveClient<TRequest>;
  private intervalMs: number;
  private previousSolvedFrame: LiveSolveResponse | null;
  private latestSolvedFrame: LiveSolveResponse | null;
  private latestSolvedFrameReceivedAtMs: number | null;
  private status: LiveSolveStatus;
  private error: string | null;
  private lastRequestMs: number;
  private inFlight: Promise<void> | null;
  private frameChanged: boolean;
  private failureThreshold: number;
  private circuitBackoffMs: number;
  private healthCheck: LiveSolveHealthCheck | null;
  private consecutiveFailures: number;
  private circuitOpenedAtMs: number | null;
  private healthProbeInFlight: boolean;
  private lastTickMs: number;
  private clock: LiveSolveClock;
  private displayTransitionMs: number;

  constructor(client: LiveSolveClient<TRequest>,
              intervalMs = 250,
              initialSolvedFrame: LiveSolveResponse | null = null,
              options: LiveSolveSchedulerOptions = {}) {
    this.client = client;
    this.intervalMs = intervalMs;
    this.previousSolvedFrame = null;
    this.latestSolvedFrame = initialSolvedFrame;
    this.latestSolvedFrameReceivedAtMs = initialSolvedFrame ? 0 : null;
    this.status = initialSolvedFrame ? "ready" : "idle";
    this.error = null;
    this.lastRequestMs = -Infinity;
    this.inFlight = null;
    this.frameChanged = false;
    this.failureThreshold = options.failureThreshold ?? 3;
    this.circuitBackoffMs = options.circuitBackoffMs ?? 1000;
    this.healthCheck = options.healthCheck ?? null;
    this.consecutiveFailures = 0;
    this.circuitOpenedAtMs = null;
    this.healthProbeInFlight = false;
    this.lastTickMs = 0;
    this.clock = options.clock ?? (() => performance.now());
    this.displayTransitionMs = options.displayTransitionMs ?? intervalMs;
  }

  async requestNow(request: TRequest): Promise<void> {
    if (this.status === "retrying") {
      return;
    }
    if (this.inFlight) {
      await this.inFlight;
    }

    this.status = "solving";
    this.error = null;
    this.inFlight = this.client(request)
      .then((response) => {
        this.previousSolvedFrame = this.latestSolvedFrame;
        this.latestSolvedFrame = response;
        this.latestSolvedFrameReceivedAtMs = this.clock();
        this.status = "ready";
        this.consecutiveFailures = 0;
        this.circuitOpenedAtMs = null;
        this.frameChanged = true;
      })
      .catch((error: unknown) => {
        this.consecutiveFailures += 1;
        this.error = error instanceof Error ? error.message : String(error);
        if (this.consecutiveFailures >= this.failureThreshold) {
          this.status = "retrying";
          this.circuitOpenedAtMs = this.lastRequestMs === -Infinity ? 0 : this.lastRequestMs;
          return;
        }
        this.status = this.latestSolvedFrame ? "stale" : "idle";
      })
      .finally(() => {
        this.inFlight = null;
      });
    await this.inFlight;
  }

  async tick(nowMs: number,
             requestFactory: () => TRequest): Promise<void> {
    this.lastTickMs = nowMs;
    if (this.status === "retrying") {
      await this.tryRecoverCircuit(nowMs, requestFactory);
      return;
    }

    if (this.inFlight || nowMs - this.lastRequestMs < this.intervalMs) {
      return;
    }

    this.lastRequestMs = nowMs;
    await this.requestNow(requestFactory());
  }

  private async tryRecoverCircuit(nowMs: number,
                                  requestFactory: () => TRequest): Promise<void> {
    if (this.healthProbeInFlight) {
      return;
    }

    const openedAtMs = this.circuitOpenedAtMs ?? nowMs;
    if (nowMs - openedAtMs < this.circuitBackoffMs) {
      return;
    }

    this.healthProbeInFlight = true;
    try {
      if (this.healthCheck) {
        try {
          await this.healthCheck();
        } catch (error: unknown) {
          this.error = error instanceof Error ? error.message : String(error);
          // Pace the next probe from completion (latest observed tick), so a
          // slow-failing probe does not re-fire immediately after settling.
          this.circuitOpenedAtMs = this.lastTickMs;
          return;
        }
      }

      this.consecutiveFailures = 0;
      this.circuitOpenedAtMs = null;
      this.status = this.latestSolvedFrame ? "stale" : "idle";
      this.lastRequestMs = nowMs;
      await this.requestNow(requestFactory());
    } finally {
      this.healthProbeInFlight = false;
    }
  }

  getLatestSolvedFrame(): LiveSolveResponse | null {
    return this.latestSolvedFrame;
  }

  getLatestSolvedFrameAgeMs(nowMs = this.clock()): number | null {
    if (this.latestSolvedFrameReceivedAtMs === null) {
      return null;
    }
    const ageMs = Math.max(0, nowMs - this.latestSolvedFrameReceivedAtMs);
    return ageMs;
  }

  getDisplayFrame(nowMs = this.clock()): LiveSolveResponse | null {
    if (!this.latestSolvedFrame) {
      return null;
    }
    if (
      !this.previousSolvedFrame
      || this.latestSolvedFrameReceivedAtMs === null
      || this.displayTransitionMs <= 0
    ) {
      return this.latestSolvedFrame;
    }

    const progress = (
      (nowMs - this.latestSolvedFrameReceivedAtMs)
      / this.displayTransitionMs
    );
    const displayFrame = interpolateLiveSolveResponse(
      this.previousSolvedFrame,
      this.latestSolvedFrame,
      progress
    );
    return displayFrame;
  }

  getStatus(): LiveSolveStatus {
    return this.status;
  }

  getError(): string | null {
    return this.error;
  }

  consumeFrameChanged(): boolean {
    const hasFrameChanged = this.frameChanged;
    this.frameChanged = false;
    return hasFrameChanged;
  }
}
