export interface PerformanceMonitorOptions {
  traceId: string;
  slowFrameMs?: number;
  slowLiveSolveMs?: number;
  capacity?: number;
}

export interface PerformanceSample {
  sample_id: string;
  trace_id: string;
  span_id: string;
  metric_name: string;
  component: "viewer";
  duration_ms: number;
  is_slow: boolean;
  fields: Record<string, unknown>;
}

export interface PerformanceSummary {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  slow_count: number;
  slow_ratio: number;
}

function percentile(sortedValues: number[], fraction: number): number {
  const index = Math.round((sortedValues.length - 1) * fraction);
  return sortedValues[index];
}

function summarizeGroup(samples: PerformanceSample[]): PerformanceSummary {
  const durations = samples.map((sample) => sample.duration_ms).sort((a, b) => a - b);
  const slowCount = samples.filter((sample) => sample.is_slow).length;
  const summary = {
    count: samples.length,
    min: durations[0],
    max: durations[durations.length - 1],
    mean: durations.reduce((total, duration) => total + duration, 0) / samples.length,
    p50: percentile(durations, 0.5),
    p95: percentile(durations, 0.95),
    p99: percentile(durations, 0.99),
    slow_count: slowCount,
    slow_ratio: slowCount / samples.length
  };
  return summary;
}

export function summarizePerformanceSamples(samples: PerformanceSample[]): Record<string, PerformanceSummary> {
  const groupedSamples = new Map<string, PerformanceSample[]>();
  for (const sample of samples) {
    const metricSamples = groupedSamples.get(sample.metric_name) ?? [];
    metricSamples.push(sample);
    groupedSamples.set(sample.metric_name, metricSamples);
  }

  const summaries: Record<string, PerformanceSummary> = {};
  for (const [metricName, metricSamples] of groupedSamples.entries()) {
    summaries[metricName] = summarizeGroup(metricSamples);
  }
  return summaries;
}

export class PerformanceMonitor {
  private traceId: string;
  private slowFrameMs: number;
  private slowLiveSolveMs: number;
  private capacity: number;
  private retainedSamples: PerformanceSample[];
  private sampleSequence: number;

  constructor(options: PerformanceMonitorOptions) {
    this.traceId = options.traceId;
    this.slowFrameMs = options.slowFrameMs ?? 33;
    this.slowLiveSolveMs = options.slowLiveSolveMs ?? 250;
    this.capacity = options.capacity ?? 1000;
    this.retainedSamples = [];
    this.sampleSequence = 0;
  }

  recordFrame(spanId: string,
              durationMs: number,
              fields: Record<string, unknown> = {}): void {
    this.recordSample("frame_ms", spanId, durationMs, this.slowFrameMs, fields);
  }

  recordLiveSolve(spanId: string,
                  durationMs: number,
                  fields: Record<string, unknown> = {}): void {
    this.recordSample("live_solve_ms", spanId, durationMs, this.slowLiveSolveMs, fields);
  }

  samples(): PerformanceSample[] {
    return [...this.retainedSamples];
  }

  teardown(): void {
    this.retainedSamples = [];
  }

  private recordSample(metricName: string,
                       spanId: string,
                       durationMs: number,
                       slowThresholdMs: number,
                       fields: Record<string, unknown>): void {
    if (durationMs < 0) {
      throw new Error("durationMs must be non-negative");
    }
    this.sampleSequence += 1;
    const sampleId = `${this.traceId}:${spanId}:${metricName}:${this.sampleSequence}`;
    const sample = {
      sample_id: sampleId,
      trace_id: this.traceId,
      span_id: spanId,
      metric_name: metricName,
      component: "viewer" as const,
      duration_ms: durationMs,
      is_slow: durationMs > slowThresholdMs,
      fields
    };
    this.retainedSamples.push(sample);
    if (this.retainedSamples.length > this.capacity) {
      this.retainedSamples = this.retainedSamples.slice(
        this.retainedSamples.length - this.capacity
      );
    }
  }
}
