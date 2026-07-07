export interface SceneTrace {
  schema_version: string;
  metadata: SceneMetadata;
  truth: TruthSection;
  measurements: MeasurementSection;
  estimates: Record<string, PositionEstimate[]>;
  metrics: Record<string, Record<string, number>>;
  trace: TraceSection;
}

export interface SceneMetadata {
  scenario: string;
  units: string;
  dimension: number;
}

export interface TruthSection {
  nodes: TruthNode[];
}

export interface TruthNode {
  id: string;
  position_m: number[];
}

export interface MeasurementSection {
  gnss: GnssMeasurement[];
  uwb: UwbMeasurement[];
  references: ReferenceMeasurement[];
}

export interface GnssMeasurement {
  agent_id: string;
  position_m: number[];
  sigma_m: number;
  uncertainty: GnssUncertainty;
}

export interface GnssUncertainty {
  type: string;
  radius_m: number;
}

export interface UwbMeasurement {
  source_id: string;
  target_id: string;
  measured_distance_m: number;
  sigma_m: number;
  true_distance_m: number | null;
}

export interface ReferenceMeasurement {
  agent_id: string;
  position_m: number[];
  sigma_m: number | null;
}

export interface PositionEstimate {
  agent_id: string;
  position_m: number[];
}

export interface TraceSection {
  trace_type: string;
  iterations: TraceIteration[];
}

export interface TraceIteration {
  iteration: number;
  positions: Record<string, number[]>;
  cost: TraceCost;
  residuals: TraceResiduals;
}

export interface TraceCost {
  total: number;
  gnss: number;
  uwb: number;
  reference: number;
}

export interface TraceResiduals {
  gnss: GnssResidual[];
  uwb: UwbResidual[];
  reference: ReferenceResidual[];
}

export interface GnssResidual {
  agent_id: string;
  vector: number[];
  norm: number;
  weighted_sq: number;
}

export interface UwbResidual {
  source_id: string;
  target_id: string;
  residual_m: number;
  weighted_sq: number;
}

export interface ReferenceResidual {
  agent_id: string;
  vector: number[];
  norm: number;
  weighted_sq: number;
}

