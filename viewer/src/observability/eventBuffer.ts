export type LoggingMode = "normal" | "debug";

export interface ViewerSessionOptions {
  component: string;
  scenario?: string;
  mode: string;
}

export interface ViewerObservabilitySession {
  sessionId: string;
  traceId: string;
  component: string;
  scenario?: string;
  mode: LoggingMode;
  startedAt: string;
}

export interface ObservationEvent {
  event_id: string;
  timestamp: string;
  session_id: string;
  trace_id: string;
  span_id: string;
  parent_span_id?: string | null;
  correlation_id?: string | null;
  request_id?: string | null;
  component: string;
  event: string;
  duration_ms?: number | null;
  fields: Record<string, unknown>;
}

export interface EventInput {
  spanId: string;
  event: string;
  parentSpanId?: string | null;
  correlationId?: string | null;
  requestId?: string | null;
  durationMs?: number | null;
  fields?: Record<string, unknown>;
}

type FlushTarget = (events: ObservationEvent[]) => Promise<void>;

let eventSequence = 0;

function randomId(prefix: string): string {
  const randomValue = Math.random().toString(16).slice(2);
  return `${prefix}-${Date.now().toString(36)}-${randomValue}`;
}

function validateLoggingMode(mode: string): LoggingMode {
  if (mode !== "normal" && mode !== "debug") {
    throw new Error("logging mode must be normal or debug");
  }
  return mode;
}

export function createViewerSession(options: ViewerSessionOptions): ViewerObservabilitySession {
  const mode = validateLoggingMode(options.mode);
  const session = {
    sessionId: randomId("session"),
    traceId: randomId("trace"),
    component: options.component,
    scenario: options.scenario,
    mode,
    startedAt: new Date().toISOString()
  };
  return session;
}

export function createObservationEvent(session: ViewerObservabilitySession,
                                       input: EventInput): ObservationEvent {
  eventSequence += 1;
  const eventId = `${session.sessionId}:${input.spanId}:${input.event}:${eventSequence}`;
  const event = {
    event_id: eventId,
    timestamp: new Date().toISOString(),
    session_id: session.sessionId,
    trace_id: session.traceId,
    span_id: input.spanId,
    parent_span_id: input.parentSpanId ?? null,
    correlation_id: input.correlationId ?? null,
    request_id: input.requestId ?? null,
    component: session.component,
    event: input.event,
    duration_ms: input.durationMs ?? null,
    fields: input.fields ?? {}
  };
  JSON.stringify(event);
  return event;
}

export class BrowserEventBuffer {
  private capacity: number;
  private events: ObservationEvent[];
  private inFlightFlush: Promise<void> | null;

  constructor(capacity = 1000) {
    this.capacity = capacity;
    this.events = [];
    this.inFlightFlush = null;
  }

  record(event: ObservationEvent): void {
    JSON.stringify(event);
    this.events.push(event);
    if (this.events.length > this.capacity) {
      this.events = this.events.slice(this.events.length - this.capacity);
    }
  }

  pendingCount(): number {
    return this.events.length;
  }

  snapshot(): ObservationEvent[] {
    return [...this.events];
  }

  async flush(target: FlushTarget): Promise<void> {
    if (this.inFlightFlush) {
      await this.inFlightFlush;
      return;
    }

    const pendingEvents = this.snapshot();
    if (pendingEvents.length === 0) {
      return;
    }

    const flushedEventIds = new Set(pendingEvents.map((event) => event.event_id));
    this.inFlightFlush = target(pendingEvents)
      .then(() => {
        this.events = this.events.filter((event) => !flushedEventIds.has(event.event_id));
      })
      .finally(() => {
        this.inFlightFlush = null;
      });
    await this.inFlightFlush;
  }
}
