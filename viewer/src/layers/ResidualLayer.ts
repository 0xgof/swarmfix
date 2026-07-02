import type { SceneTrace } from "../data/sceneTypes";

export interface GnssResidualModel {
  agentId: string;
  vector: number[];
  norm: number;
  weightedSq: number;
}

export interface UwbResidualModel {
  sourceId: string;
  targetId: string;
  residualM: number;
  weightedSq: number;
}

export interface ReferenceResidualModel {
  agentId: string;
  vector: number[];
  norm: number;
  weightedSq: number;
}

export interface ResidualLayerModel {
  gnss: GnssResidualModel[];
  uwb: UwbResidualModel[];
  reference: ReferenceResidualModel[];
}

export function buildResidualLayerModel(sceneTrace: SceneTrace,
                                        iterationIndex: number): ResidualLayerModel {
  const traceIteration = sceneTrace.trace.iterations[iterationIndex];
  if (!traceIteration) {
    return { gnss: [], uwb: [], reference: [] };
  }

  const gnss = traceIteration.residuals.gnss.map((residual) => ({
    agentId: residual.agent_id,
    vector: residual.vector,
    norm: residual.norm,
    weightedSq: residual.weighted_sq
  }));
  const uwb = traceIteration.residuals.uwb.map((residual) => ({
    sourceId: residual.source_id,
    targetId: residual.target_id,
    residualM: residual.residual_m,
    weightedSq: residual.weighted_sq
  }));
  const reference = traceIteration.residuals.reference.map((residual) => ({
    agentId: residual.agent_id,
    vector: residual.vector,
    norm: residual.norm,
    weightedSq: residual.weighted_sq
  }));
  const residualModel = { gnss, uwb, reference };
  return residualModel;
}
