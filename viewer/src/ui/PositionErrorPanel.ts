import type { PositionEstimate, SceneTrace, TruthNode } from "../data/sceneTypes";
import type { LiveSolveResponse } from "../live/liveSolveTypes";

export interface PositionErrorBreakdown {
  estimateMethod: "fused" | "corrected";
  rmseM: number;
  meanErrorM: number;
  maxErrorM: number;
}

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

function errorBreakdown(truthNodes: TruthNode[],
                        estimates: PositionEstimate[],
                        estimateMethod: "fused" | "corrected"): PositionErrorBreakdown | null {
  const estimateByAgent = new Map(
    estimates.map((estimate) => [estimate.agent_id, estimate.position_m])
  );
  const errors = truthNodes
    .map((truthNode) => {
      const estimatePosition = estimateByAgent.get(truthNode.id);
      if (!estimatePosition) {
        return null;
      }
      const errorM = distanceBetween(truthNode.position_m, estimatePosition);
      return errorM;
    })
    .filter((errorM): errorM is number => errorM !== null);

  if (errors.length === 0) {
    return null;
  }

  const squaredErrorSum = errors.reduce((total, errorM) => total + errorM ** 2, 0);
  const errorSum = errors.reduce((total, errorM) => total + errorM, 0);
  const breakdown = {
    estimateMethod,
    rmseM: Math.sqrt(squaredErrorSum / errors.length),
    meanErrorM: errorSum / errors.length,
    maxErrorM: Math.max(...errors)
  };
  return breakdown;
}

export function getPositionErrorBreakdown(sceneTrace: SceneTrace,
                                          liveSolveFrame: LiveSolveResponse | null = null): PositionErrorBreakdown | null {
  if (liveSolveFrame && liveSolveFrame.estimates.fused.length > 0) {
    const liveTruthNodes = liveSolveFrame.truth.map((agent) => ({
      id: agent.agent_id,
      position_m: agent.position_m
    }));
    const truthNodes = liveTruthNodes.length > 0
      ? liveTruthNodes
      : sceneTrace.truth.nodes;
    const liveError = errorBreakdown(
      truthNodes,
      liveSolveFrame.estimates.fused,
      "fused"
    );
    return liveError;
  }

  const correctedEstimates = sceneTrace.estimates.corrected;
  if (correctedEstimates && correctedEstimates.length > 0) {
    const correctedError = errorBreakdown(
      sceneTrace.truth.nodes,
      correctedEstimates,
      "corrected"
    );
    return correctedError;
  }

  const fusedError = errorBreakdown(
    sceneTrace.truth.nodes,
    sceneTrace.estimates.fused ?? [],
    "fused"
  );
  return fusedError;
}
