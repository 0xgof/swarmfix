import type { SceneTrace } from "../data/sceneTypes";
import { toPosition2D } from "../utils/geometry";

export function buildTruthLayerModel(sceneTrace: SceneTrace): Array<{
  agentId: string;
  position: [number, number];
}> {
  const truthNodes = sceneTrace.truth.nodes.map((node) => ({
    agentId: node.id,
    position: toPosition2D(node.position_m)
  }));
  return truthNodes;
}
