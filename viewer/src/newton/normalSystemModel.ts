import type { LiveSolveRequest } from "../live/liveSolveTypes";

export type CoordinateLabel = "x" | "y" | "z" | `d${number}`;

export interface GnssResidualRow {
  kind: "gnss";
  agentId: string;
  coordinate: CoordinateLabel;
  sigmaM: number;
}

export interface UwbResidualRow {
  kind: "uwb";
  sourceId: string;
  targetId: string;
  sigmaM: number;
  measuredDistanceM: number;
}

export type ResidualRow = GnssResidualRow | UwbResidualRow;

export interface PositionVariableColumn {
  agentId: string;
  coordinate: CoordinateLabel;
}

export interface NormalSystemSnapshot {
  iteration: number;
  agentIds: string[];
  dimension: number;
  residualRows: ResidualRow[];
  variableColumns: PositionVariableColumn[];
  residualVector: number[];
  jacobian: number[][];
  normalMatrix: number[][];
  gradient: number[];
  rhs: number[];
  damping: number;
  dampedNormalMatrix: number[][];
  delta: number[];
  positions: Record<string, number[]>;
  candidatePositions: Record<string, number[]>;
  costBefore: number;
  costAfter: number;
  accepted: boolean;
}

export interface NormalSystemOptions {
  damping?: number;
  iteration?: number;
  positions?: Record<string, number[]>;
}

const DEFAULT_DAMPING = 1e-6;
const COORDINATE_LABELS: CoordinateLabel[] = ["x", "y", "z"];

function coordinateLabel(index: number): CoordinateLabel {
  const label = COORDINATE_LABELS[index] ?? `d${index}`;
  return label;
}

function clonePositions(positions: Record<string, number[]>): Record<string, number[]> {
  const clonedPositions: Record<string, number[]> = {};
  for (const [agentId, position] of Object.entries(positions)) {
    clonedPositions[agentId] = [...position];
  }
  return clonedPositions;
}

function initialPositions(request: LiveSolveRequest,
                          positions?: Record<string, number[]>): Record<string, number[]> {
  if (positions) {
    return clonePositions(positions);
  }

  const requestPositions: Record<string, number[]> = {};
  for (const agent of request.agents) {
    requestPositions[agent.agent_id] = agent.position_m.slice(0, request.dimension);
  }
  return requestPositions;
}

function dot(left: number[], right: number[]): number {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += left[index] * right[index];
  }
  return total;
}

function cleanZero(value: number): number {
  if (Math.abs(value) < 1e-12) {
    return 0;
  }
  return value;
}

function zeros(rows: number, columns: number): number[][] {
  const matrix = Array.from(
    { length: rows },
    () => Array.from({ length: columns }, () => 0)
  );
  return matrix;
}

function transposeMultiplyMatrix(jacobian: number[][]): number[][] {
  const columns = jacobian[0]?.length ?? 0;
  const normalMatrix = zeros(columns, columns);

  for (const row of jacobian) {
    for (let left = 0; left < columns; left += 1) {
      for (let right = 0; right < columns; right += 1) {
        normalMatrix[left][right] += row[left] * row[right];
      }
    }
  }
  return normalMatrix;
}

function transposeMultiplyVector(jacobian: number[][], residualVector: number[]): number[] {
  const columns = jacobian[0]?.length ?? 0;
  const gradient = Array.from({ length: columns }, () => 0);

  for (let rowIndex = 0; rowIndex < jacobian.length; rowIndex += 1) {
    const row = jacobian[rowIndex];
    const residual = residualVector[rowIndex];
    for (let column = 0; column < columns; column += 1) {
      gradient[column] += row[column] * residual;
    }
  }
  return gradient;
}

function withDamping(normalMatrix: number[][], damping: number): number[][] {
  const dampedNormalMatrix = normalMatrix.map((row) => [...row]);
  for (let index = 0; index < dampedNormalMatrix.length; index += 1) {
    dampedNormalMatrix[index][index] += damping;
  }
  return dampedNormalMatrix;
}

function buildVariableColumns(agentIds: string[], dimension: number): PositionVariableColumn[] {
  const variableColumns: PositionVariableColumn[] = [];
  for (const agentId of agentIds) {
    for (let coordinate = 0; coordinate < dimension; coordinate += 1) {
      variableColumns.push({ agentId, coordinate: coordinateLabel(coordinate) });
    }
  }
  return variableColumns;
}

function agentColumnOffset(agentIds: string[], dimension: number): Map<string, number> {
  const offsets = new Map<string, number>();
  agentIds.forEach((agentId, index) => {
    offsets.set(agentId, index * dimension);
  });
  return offsets;
}

function buildResidualModel(request: LiveSolveRequest,
                            positions: Record<string, number[]>): {
  residualRows: ResidualRow[];
  residualVector: number[];
  jacobian: number[][];
} {
  const agentIds = request.agents.map((agent) => agent.agent_id);
  const columnOffsets = agentColumnOffset(agentIds, request.dimension);
  const variableCount = agentIds.length * request.dimension;
  const residualRows: ResidualRow[] = [];
  const residualVector: number[] = [];
  const jacobian: number[][] = [];

  for (const measurement of request.gnss) {
    const offset = columnOffsets.get(measurement.agent_id);
    const position = positions[measurement.agent_id];
    if (offset === undefined || !position) {
      continue;
    }
    for (let coordinate = 0; coordinate < request.dimension; coordinate += 1) {
      const row = Array.from({ length: variableCount }, () => 0);
      const invSigma = 1 / measurement.sigma_m;
      row[offset + coordinate] = invSigma;
      residualRows.push({
        kind: "gnss",
        agentId: measurement.agent_id,
        coordinate: coordinateLabel(coordinate),
        sigmaM: measurement.sigma_m
      });
      residualVector.push(
        ((position[coordinate] ?? 0) - (measurement.position_m[coordinate] ?? 0)) * invSigma
      );
      jacobian.push(row);
    }
  }

  for (const measurement of request.uwb) {
    const sourceOffset = columnOffsets.get(measurement.source_id);
    const targetOffset = columnOffsets.get(measurement.target_id);
    const sourcePosition = positions[measurement.source_id];
    const targetPosition = positions[measurement.target_id];
    if (
      sourceOffset === undefined
      || targetOffset === undefined
      || !sourcePosition
      || !targetPosition
    ) {
      continue;
    }

    const differences = [];
    for (let coordinate = 0; coordinate < request.dimension; coordinate += 1) {
      differences.push((sourcePosition[coordinate] ?? 0) - (targetPosition[coordinate] ?? 0));
    }
    const distance = Math.max(Math.sqrt(dot(differences, differences)), 1e-12);
    const invSigma = 1 / measurement.sigma_m;
    const row = Array.from({ length: variableCount }, () => 0);
    for (let coordinate = 0; coordinate < request.dimension; coordinate += 1) {
      const derivative = cleanZero(differences[coordinate] / distance * invSigma);
      row[sourceOffset + coordinate] = derivative;
      row[targetOffset + coordinate] = cleanZero(-derivative);
    }
    residualRows.push({
      kind: "uwb",
      sourceId: measurement.source_id,
      targetId: measurement.target_id,
      sigmaM: measurement.sigma_m,
      measuredDistanceM: measurement.distance_m
    });
    residualVector.push((distance - measurement.distance_m) * invSigma);
    jacobian.push(row);
  }

  return { residualRows, residualVector, jacobian };
}

function solveLinearSystem(matrix: number[][], rhs: number[]): number[] {
  const size = rhs.length;
  const workingMatrix = matrix.map((row) => [...row]);
  const workingRhs = [...rhs];
  const solution = Array.from({ length: size }, () => 0);

  for (let pivot = 0; pivot < size; pivot += 1) {
    let bestRow = pivot;
    let bestValue = Math.abs(workingMatrix[pivot][pivot]);
    for (let row = pivot + 1; row < size; row += 1) {
      const candidate = Math.abs(workingMatrix[row][pivot]);
      if (candidate > bestValue) {
        bestValue = candidate;
        bestRow = row;
      }
    }
    if (bestValue < 1e-14) {
      return solution;
    }
    if (bestRow !== pivot) {
      [workingMatrix[pivot], workingMatrix[bestRow]] = [workingMatrix[bestRow], workingMatrix[pivot]];
      [workingRhs[pivot], workingRhs[bestRow]] = [workingRhs[bestRow], workingRhs[pivot]];
    }
    for (let row = pivot + 1; row < size; row += 1) {
      const factor = workingMatrix[row][pivot] / workingMatrix[pivot][pivot];
      workingMatrix[row][pivot] = 0;
      for (let column = pivot + 1; column < size; column += 1) {
        workingMatrix[row][column] -= factor * workingMatrix[pivot][column];
      }
      workingRhs[row] -= factor * workingRhs[pivot];
    }
  }

  for (let row = size - 1; row >= 0; row -= 1) {
    let sum = workingRhs[row];
    for (let column = row + 1; column < size; column += 1) {
      sum -= workingMatrix[row][column] * solution[column];
    }
    solution[row] = sum / workingMatrix[row][row];
  }
  return solution;
}

function applyDelta(agentIds: string[],
                    dimension: number,
                    positions: Record<string, number[]>,
                    delta: number[]): Record<string, number[]> {
  const candidatePositions = clonePositions(positions);
  for (let agentIndex = 0; agentIndex < agentIds.length; agentIndex += 1) {
    const agentId = agentIds[agentIndex];
    for (let coordinate = 0; coordinate < dimension; coordinate += 1) {
      const variableIndex = agentIndex * dimension + coordinate;
      candidatePositions[agentId][coordinate] += delta[variableIndex];
    }
  }
  return candidatePositions;
}

function costForResiduals(residualVector: number[]): number {
  const cost = dot(residualVector, residualVector);
  return cost;
}

export function buildNormalSystemSnapshot(request: LiveSolveRequest,
                                          options: NormalSystemOptions = {}): NormalSystemSnapshot {
  const damping = options.damping ?? DEFAULT_DAMPING;
  const positions = initialPositions(request, options.positions);
  const agentIds = request.agents.map((agent) => agent.agent_id);
  const variableColumns = buildVariableColumns(agentIds, request.dimension);
  const { residualRows, residualVector, jacobian } = buildResidualModel(request, positions);
  const normalMatrix = transposeMultiplyMatrix(jacobian);
  const gradient = transposeMultiplyVector(jacobian, residualVector);
  const rhs = gradient.map((value) => -value);
  const dampedNormalMatrix = withDamping(normalMatrix, damping);
  const delta = solveLinearSystem(dampedNormalMatrix, rhs);
  const candidatePositions = applyDelta(agentIds, request.dimension, positions, delta);
  const candidateResiduals = buildResidualModel(request, candidatePositions).residualVector;
  const costBefore = costForResiduals(residualVector);
  const costAfter = costForResiduals(candidateResiduals);
  const accepted = Number.isFinite(costAfter) && costAfter <= costBefore;

  const snapshot: NormalSystemSnapshot = {
    iteration: options.iteration ?? 0,
    agentIds,
    dimension: request.dimension,
    residualRows,
    variableColumns,
    residualVector,
    jacobian,
    normalMatrix,
    gradient,
    rhs,
    damping,
    dampedNormalMatrix,
    delta,
    positions,
    candidatePositions,
    costBefore,
    costAfter,
    accepted
  };
  return snapshot;
}

export function stepNormalSystem(request: LiveSolveRequest,
                                 options: NormalSystemOptions = {}): NormalSystemSnapshot {
  const snapshot = buildNormalSystemSnapshot(request, options);
  return snapshot;
}
