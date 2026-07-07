import type { SceneTrace } from "../data/sceneTypes";
import type { LiveSolveResponse } from "../live/liveSolveTypes";
import { distance2D } from "../utils/geometry";

export interface EdgeInspectorModel {
  sourceId: string;
  targetId: string;
  measuredDistanceM: number;
  sigmaM: number;
  trueDistanceM: number | null;
  currentDistanceM: number | null;
  residualM: number | null;
  weightedSq: number | null;
}

export function edgeKey(sourceId: string,
                        targetId: string): string {
  const key = `${sourceId}->${targetId}`;
  return key;
}

export function buildEdgeInspectorModel(sceneTrace: SceneTrace,
                                        sourceId: string,
                                        targetId: string,
                                        iterationIndex: number,
                                        liveSolveFrame: LiveSolveResponse | null = null): EdgeInspectorModel | null {
  const liveEdge = liveSolveFrame?.constraints.edges.find((edge) => (
    edge.source_id === sourceId
    && edge.target_id === targetId
  ));
  const liveIteration = liveSolveFrame?.trace.iterations[
    liveSolveFrame.trace.iterations.length - 1
  ];
  if (liveEdge) {
    const positions = liveIteration?.positions ?? {};
    const sourcePosition = positions[sourceId] ?? null;
    const targetPosition = positions[targetId] ?? null;
    const currentDistanceM = sourcePosition && targetPosition
      ? Math.hypot(
        (sourcePosition[0] ?? 0) - (targetPosition[0] ?? 0),
        (sourcePosition[1] ?? 0) - (targetPosition[1] ?? 0),
        (sourcePosition[2] ?? 0) - (targetPosition[2] ?? 0)
      )
      : null;
    const liveEdgeModel = {
      sourceId,
      targetId,
      measuredDistanceM: liveEdge.measured_distance_m,
      sigmaM: liveEdge.sigma_m,
      trueDistanceM: null,
      currentDistanceM,
      residualM: liveEdge.residual_m,
      weightedSq: liveEdge.weighted_sq
    };
    return liveEdgeModel;
  }

  const measurement = sceneTrace.measurements.uwb.find((uwbMeasurement) => (
    uwbMeasurement.source_id === sourceId
    && uwbMeasurement.target_id === targetId
  ));
  if (!measurement) {
    return null;
  }

  const positions = sceneTrace.trace.iterations[iterationIndex]?.positions ?? {};
  const sourcePosition = positions[sourceId] ?? null;
  const targetPosition = positions[targetId] ?? null;
  const currentDistanceM = sourcePosition && targetPosition
    ? distance2D(sourcePosition, targetPosition)
    : null;
  const residual = sceneTrace.trace.iterations[iterationIndex]?.residuals.uwb
    .find((uwbResidual) => (
      uwbResidual.source_id === sourceId
      && uwbResidual.target_id === targetId
    ));
  const edgeModel = {
    sourceId,
    targetId,
    measuredDistanceM: measurement.measured_distance_m,
    sigmaM: measurement.sigma_m,
    trueDistanceM: measurement.true_distance_m,
    currentDistanceM,
    residualM: residual?.residual_m ?? null,
    weightedSq: residual?.weighted_sq ?? null
  };
  return edgeModel;
}
