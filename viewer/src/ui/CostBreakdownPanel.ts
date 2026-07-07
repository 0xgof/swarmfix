import type { SceneTrace, TraceCost } from "../data/sceneTypes";
import type { LiveSolveResponse } from "../live/liveSolveTypes";

export function getCostBreakdown(sceneTrace: SceneTrace,
                                 iterationIndex: number,
                                 liveSolveFrame: LiveSolveResponse | null = null): TraceCost | null {
  const liveIteration = liveSolveFrame?.trace.iterations[
    liveSolveFrame.trace.iterations.length - 1
  ];
  if (liveIteration) {
    const liveCost = {
      total: liveIteration.cost_total,
      gnss: liveIteration.cost_gnss,
      uwb: liveIteration.cost_uwb,
      reference: 0
    };
    return liveCost;
  }

  const cost = sceneTrace.trace.iterations[iterationIndex]?.cost ?? null;
  return cost;
}
