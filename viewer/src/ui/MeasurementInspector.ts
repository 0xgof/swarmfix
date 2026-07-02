import type { SceneTrace } from "../data/sceneTypes";

export function buildMeasurementInspectorModel(sceneTrace: SceneTrace,
                                               agentId: string): {
  agentId: string;
  gnssSigmaM: number | null;
  gnssPosition: number[] | null;
  referencePosition: number[] | null;
} {
  const gnssMeasurement = sceneTrace.measurements.gnss.find(
    (measurement) => measurement.agent_id === agentId
  );
  const referenceMeasurement = sceneTrace.measurements.references.find(
    (measurement) => measurement.agent_id === agentId
  );
  const measurementModel = {
    agentId,
    gnssSigmaM: gnssMeasurement?.sigma_m ?? null,
    gnssPosition: gnssMeasurement?.position_m ?? null,
    referencePosition: referenceMeasurement?.position_m ?? null
  };
  return measurementModel;
}
