import type { TraceIteration } from "../data/sceneTypes";

function interpolatePosition(a: number[],
                             b: number[],
                             t: number): number[] {
  const interpolatedPosition = [
    (a[0] ?? 0) + ((b[0] ?? 0) - (a[0] ?? 0)) * t,
    (a[1] ?? 0) + ((b[1] ?? 0) - (a[1] ?? 0)) * t
  ];
  return interpolatedPosition;
}

export function interpolateTraceStates(from: TraceIteration,
                                       to: TraceIteration,
                                       t: number): Record<string, number[]> {
  const boundedT = Math.min(1, Math.max(0, t));
  const positions: Record<string, number[]> = {};

  for (const [agentId, fromPosition] of Object.entries(from.positions)) {
    const toPosition = to.positions[agentId] ?? fromPosition;
    positions[agentId] = interpolatePosition(fromPosition, toPosition, boundedT);
  }

  return positions;
}
