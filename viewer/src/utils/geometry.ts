import { Vector3 } from "three";

import { liftPositionTo3D } from "../animation/liveMotion";

export type Position2D = [number, number];

export function toPosition2D(position: number[]): Position2D {
  const position2D: Position2D = [position[0] ?? 0, position[1] ?? 0];
  return position2D;
}

export function toVector3(position: number[],
                          z = 0): Vector3 {
  const liftedPosition = position.length >= 3
    ? [position[0] ?? 0, position[1] ?? 0, position[2] ?? 0]
    : liftPositionTo3D(position);
  const vector = new Vector3(liftedPosition[0], liftedPosition[1] + z, liftedPosition[2]);
  return vector;
}

export function distance2D(a: number[],
                           b: number[]): number {
  const dx = (a[0] ?? 0) - (b[0] ?? 0);
  const dy = (a[1] ?? 0) - (b[1] ?? 0);
  const distance = Math.hypot(dx, dy);
  return distance;
}

export function findTracePosition(positions: Record<string, number[]>,
                                  agentId: string): Position2D | null {
  const position = positions[agentId];
  if (!position) {
    return null;
  }

  const tracePosition = toPosition2D(position);
  return tracePosition;
}
