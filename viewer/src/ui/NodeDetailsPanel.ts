import type { SceneTrace } from "../data/sceneTypes";
import { buildResidualLayerModel } from "../layers/ResidualLayer";

export interface NodeInspectorModel {
  agentId: string;
  truthPosition: number[] | null;
  gnssPosition: number[] | null;
  currentEstimate: number[] | null;
  fusedEstimate: number[] | null;
  correctedEstimate: number[] | null;
  referenceMeasurement: number[] | null;
  gnssResidualNorm: number | null;
  connectedUwbLinks: Array<{ sourceId: string; targetId: string }>;
}

function findEstimate(sceneTrace: SceneTrace,
                      estimateName: string,
                      agentId: string): number[] | null {
  const estimate = sceneTrace.estimates[estimateName]?.find(
    (positionEstimate) => positionEstimate.agent_id === agentId
  );
  const position = estimate?.position_m ?? null;
  return position;
}

export function buildNodeInspectorModel(sceneTrace: SceneTrace,
                                        agentId: string,
                                        iterationIndex: number): NodeInspectorModel | null {
  const truthPosition = sceneTrace.truth.nodes.find((node) => node.id === agentId)
    ?.position_m ?? null;
  const gnssPosition = sceneTrace.measurements.gnss.find(
    (measurement) => measurement.agent_id === agentId
  )?.position_m ?? null;
  const currentEstimate = sceneTrace.trace.iterations[iterationIndex]
    ?.positions[agentId] ?? null;
  const referenceMeasurement = sceneTrace.measurements.references.find(
    (measurement) => measurement.agent_id === agentId
  )?.position_m ?? null;
  const residualModel = buildResidualLayerModel(sceneTrace, iterationIndex);
  const gnssResidualNorm = residualModel.gnss.find(
    (residual) => residual.agentId === agentId
  )?.norm ?? null;
  const connectedUwbLinks = sceneTrace.measurements.uwb
    .filter((measurement) => (
      measurement.source_id === agentId || measurement.target_id === agentId
    ))
    .map((measurement) => ({
      sourceId: measurement.source_id,
      targetId: measurement.target_id
    }));

  if (truthPosition === null && gnssPosition === null && currentEstimate === null) {
    return null;
  }

  const nodeModel = {
    agentId,
    truthPosition,
    gnssPosition,
    currentEstimate,
    fusedEstimate: findEstimate(sceneTrace, "fused", agentId),
    correctedEstimate: findEstimate(sceneTrace, "corrected", agentId),
    referenceMeasurement,
    gnssResidualNorm,
    connectedUwbLinks
  };
  return nodeModel;
}
