import type { SceneTrace } from "../data/sceneTypes";
import { toPosition2D } from "../utils/geometry";

export function buildReferenceLayerModel(sceneTrace: SceneTrace): Array<{
  agentId: string;
  position: [number, number];
  sigmaM: number | null;
}> {
  const referenceNodes = sceneTrace.measurements.references.map((reference) => ({
    agentId: reference.agent_id,
    position: toPosition2D(reference.position_m),
    sigmaM: reference.sigma_m
  }));
  return referenceNodes;
}
