import type { SceneTrace } from "../data/sceneTypes";
import { buildSolverLayerModel } from "./SolverLayer";
import { toPosition2D } from "../utils/geometry";

export interface GnssMeasurementModel {
  agentId: string;
  position: [number, number];
  sigmaM: number;
  uncertaintyRadiusM: number;
}

export interface UwbLinkModel {
  sourceId: string;
  targetId: string;
  sourcePosition: [number, number] | null;
  targetPosition: [number, number] | null;
  measuredDistanceM: number;
  sigmaM: number;
  trueDistanceM: number | null;
}

export interface ReferenceMeasurementModel {
  agentId: string;
  position: [number, number];
  sigmaM: number | null;
}

export interface MeasurementLayerModel {
  gnss: GnssMeasurementModel[];
  uwbLinks: UwbLinkModel[];
  references: ReferenceMeasurementModel[];
}

function positionsByAgent(sceneTrace: SceneTrace): Map<string, [number, number]> {
  const solverModel = buildSolverLayerModel(sceneTrace, 0);
  const positions = new Map<string, [number, number]>();

  for (const node of solverModel.nodes) {
    positions.set(node.agentId, node.position);
  }

  for (const truthNode of sceneTrace.truth.nodes) {
    if (!positions.has(truthNode.id)) {
      positions.set(truthNode.id, toPosition2D(truthNode.position_m));
    }
  }

  return positions;
}

export function buildMeasurementLayerModel(sceneTrace: SceneTrace): MeasurementLayerModel {
  const positions = positionsByAgent(sceneTrace);
  const gnss = sceneTrace.measurements.gnss.map((measurement) => ({
    agentId: measurement.agent_id,
    position: toPosition2D(measurement.position_m),
    sigmaM: measurement.sigma_m,
    uncertaintyRadiusM: measurement.uncertainty.radius_m
  }));
  const uwbLinks = sceneTrace.measurements.uwb.map((measurement) => ({
    sourceId: measurement.source_id,
    targetId: measurement.target_id,
    sourcePosition: positions.get(measurement.source_id) ?? null,
    targetPosition: positions.get(measurement.target_id) ?? null,
    measuredDistanceM: measurement.measured_distance_m,
    sigmaM: measurement.sigma_m,
    trueDistanceM: measurement.true_distance_m
  }));
  const references = sceneTrace.measurements.references.map((measurement) => ({
    agentId: measurement.agent_id,
    position: toPosition2D(measurement.position_m),
    sigmaM: measurement.sigma_m
  }));
  const measurementModel = { gnss, uwbLinks, references };
  return measurementModel;
}
