import type { PositionEstimate, SceneTrace } from "../data/sceneTypes";
import { toPosition2D } from "../utils/geometry";

export interface SolverNodeModel {
  agentId: string;
  position: [number, number];
  source: "trace" | "estimate";
}

function nodesFromEstimate(estimate: PositionEstimate[]): SolverNodeModel[] {
  const nodes = estimate.map((positionEstimate) => ({
    agentId: positionEstimate.agent_id,
    position: toPosition2D(positionEstimate.position_m),
    source: "estimate" as const
  }));
  return nodes;
}

export function buildSolverLayerModel(sceneTrace: SceneTrace,
                                      iterationIndex: number): {
  nodes: SolverNodeModel[];
} {
  const traceIteration = sceneTrace.trace.iterations[iterationIndex];
  if (!traceIteration) {
    const fallbackNodes = nodesFromEstimate(sceneTrace.estimates.fused ?? []);
    return { nodes: fallbackNodes };
  }

  const nodes = Object.entries(traceIteration.positions).map(
    ([agentId, position]) => ({
      agentId,
      position: toPosition2D(position),
      source: "trace" as const
    })
  );
  return { nodes };
}
