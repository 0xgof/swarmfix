export interface ViewerDiagnosticSample {
  timestampMs: number;
  costTotal: number;
  costGnss: number;
  costUwb: number;
  errorRmseM: number;
  errorMeanM: number;
  errorMaxM: number;
  gnssErrorRmseM?: number;
  gnssErrorMeanM?: number;
  gnssErrorMaxM?: number;
  missionDroneCount: number;
  formationMode: string;
  motionMode: string;
  speedMps: number;
  randomWalkAmplitudeM: number;
  selectedUwbLinks: number;
}

export interface DisplayErrorBreakdown {
  rmseM: number;
  meanErrorM: number;
  maxErrorM: number;
}

export interface PositionEstimateLike {
  agent_id: string;
  position_m: number[];
}

export interface DiagnosticHistoryOptions {
  windowMs?: number;
  maxSamples?: number;
}

const DEFAULT_WINDOW_MS = 60000;
const DEFAULT_MAX_SAMPLES = 300;

function distanceBetween(firstPosition: number[],
                         secondPosition: number[]): number {
  const dimension = Math.max(firstPosition.length, secondPosition.length);
  let squaredDistance = 0;
  for (let index = 0; index < dimension; index += 1) {
    const delta = (firstPosition[index] ?? 0) - (secondPosition[index] ?? 0);
    squaredDistance += delta * delta;
  }

  const distanceM = Math.sqrt(squaredDistance);
  return distanceM;
}

export function displayErrorBreakdown(
    truthPositions: Map<string, number[]>,
    estimates: PositionEstimateLike[]): DisplayErrorBreakdown | null {
  const estimateByAgent = new Map(
    estimates.map((estimate) => [estimate.agent_id, estimate.position_m])
  );
  const breakdown = positionMapErrorBreakdown(truthPositions, estimateByAgent);
  return breakdown;
}

export function gnssTruthErrorBreakdown(
    truthPositions: Map<string, number[]>,
    gnssPositions: Map<string, number[]>): DisplayErrorBreakdown | null {
  const breakdown = positionMapErrorBreakdown(truthPositions, gnssPositions);
  return breakdown;
}

function positionMapErrorBreakdown(
    truthPositions: Map<string, number[]>,
    comparisonPositions: Map<string, number[]>): DisplayErrorBreakdown | null {
  const errors: number[] = [];
  for (const [agentId, truthPosition] of truthPositions.entries()) {
    const comparisonPosition = comparisonPositions.get(agentId);
    if (!comparisonPosition) {
      continue;
    }
    errors.push(distanceBetween(truthPosition, comparisonPosition));
  }

  if (errors.length === 0) {
    return null;
  }

  const squaredErrorSum = errors.reduce((total, errorM) => total + errorM ** 2, 0);
  const errorSum = errors.reduce((total, errorM) => total + errorM, 0);
  const breakdown = {
    rmseM: Math.sqrt(squaredErrorSum / errors.length),
    meanErrorM: errorSum / errors.length,
    maxErrorM: Math.max(...errors)
  };
  return breakdown;
}

function cloneSample(sample: ViewerDiagnosticSample): ViewerDiagnosticSample {
  const clonedSample = { ...sample };
  return clonedSample;
}

export class DiagnosticHistory {
  private windowMs: number;
  private maxSamples: number;
  private retainedSamples: ViewerDiagnosticSample[];

  constructor(options: DiagnosticHistoryOptions = {}) {
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.maxSamples = options.maxSamples ?? DEFAULT_MAX_SAMPLES;
    this.retainedSamples = [];
  }

  append(sample: ViewerDiagnosticSample): void {
    this.retainedSamples.push(cloneSample(sample));
    this.prune(sample.timestampMs);
  }

  samples(): ViewerDiagnosticSample[] {
    const samples = this.retainedSamples.map(cloneSample);
    return samples;
  }

  count(): number {
    const count = this.retainedSamples.length;
    return count;
  }

  clear(): void {
    this.retainedSamples = [];
  }

  cleanup(): void {
    this.clear();
  }

  private prune(latestTimestampMs: number): void {
    const earliestTimestampMs = latestTimestampMs - this.windowMs;
    this.retainedSamples = this.retainedSamples.filter((sample) => (
      sample.timestampMs >= earliestTimestampMs
    ));
    if (this.retainedSamples.length > this.maxSamples) {
      this.retainedSamples = this.retainedSamples.slice(
        this.retainedSamples.length - this.maxSamples
      );
    }
  }
}
