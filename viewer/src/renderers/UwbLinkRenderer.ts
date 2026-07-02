import { BufferGeometry, Line } from "three";

import { liftPositionTo3D } from "../animation/liveMotion";
import { createViewerMaterials } from "../style/createMaterials";
import { toVector3 } from "../utils/geometry";

export type CordPoint = [number, number, number];

function stablePhase(sourceId: string,
                     targetId: string): number {
  const key = `${sourceId}->${targetId}`;
  let hash = 0;
  for (const char of key) {
    hash = (hash * 33 + char.charCodeAt(0)) % 100000;
  }

  const phase = hash / 100000 * Math.PI * 2;
  return phase;
}

function vectorBetween(source: number[],
                       target: number[]): CordPoint {
  const vector: CordPoint = [
    (target[0] ?? 0) - (source[0] ?? 0),
    (target[1] ?? 0) - (source[1] ?? 0),
    (target[2] ?? 0) - (source[2] ?? 0)
  ];
  return vector;
}

function normalize(vector: CordPoint): CordPoint {
  const length = Math.max(
    Math.hypot(vector[0], vector[1], vector[2]),
    1e-9
  );
  const normalizedVector: CordPoint = [
    vector[0] / length,
    vector[1] / length,
    vector[2] / length
  ];
  return normalizedVector;
}

function perpendicular(vector: CordPoint): CordPoint {
  const horizontalPerpendicular = normalize([-vector[2], 0, vector[0]]);
  if (Math.hypot(horizontalPerpendicular[0], horizontalPerpendicular[2]) > 1e-6) {
    return horizontalPerpendicular;
  }

  return [1, 0, 0];
}

function endpointEnvelope(t: number): number {
  const sourceDelta = (t - 0.12) / 0.09;
  const targetDelta = (t - 0.88) / 0.09;
  const middleDelta = (t - 0.5) / 0.22;
  const sourceEnvelope = Math.exp(-(sourceDelta * sourceDelta));
  const targetEnvelope = Math.exp(-(targetDelta * targetDelta));
  const middleSuppression = 1 - Math.exp(-(middleDelta * middleDelta));
  const envelope = Math.max(sourceEnvelope, targetEnvelope) * middleSuppression;
  return envelope;
}

export function buildUwbCordPoints(sourcePosition: number[],
                                   targetPosition: number[],
                                   sigmaM: number,
                                   timeSeconds: number,
                                   sourceId: string,
                                   targetId: string): CordPoint[] {
  const pointCount = 28;
  const linkVector = vectorBetween(sourcePosition, targetPosition);
  const normal = perpendicular(linkVector);
  const phase = stablePhase(sourceId, targetId);
  const vibrationAmplitude = 0.035 + Math.min(Math.max(sigmaM, 0), 2) * 0.18;
  const points: CordPoint[] = [];

  for (let index = 0; index < pointCount; index += 1) {
    const t = index / (pointCount - 1);
    const basePoint: CordPoint = [
      (sourcePosition[0] ?? 0) + linkVector[0] * t,
      (sourcePosition[1] ?? 0) + linkVector[1] * t,
      (sourcePosition[2] ?? 0) + linkVector[2] * t
    ];
    const wave = Math.sin(t * Math.PI * 18 + timeSeconds * 8 + phase);
    const envelope = endpointEnvelope(t);
    const displacement = wave * envelope * vibrationAmplitude;
    const cordPoint: CordPoint = [
      basePoint[0] + normal[0] * displacement,
      basePoint[1] + normal[1] * displacement,
      basePoint[2] + normal[2] * displacement
    ];
    points.push(cordPoint);
  }

  return points;
}

export function createUwbLink(sourcePosition: number[],
                              targetPosition: number[],
                              sigmaM = 0,
                              timeSeconds = 0,
                              sourceId = "source",
                              targetId = "target"): Line {
  const sourceScenePosition = sourcePosition.length >= 3
    ? sourcePosition
    : liftPositionTo3D(sourcePosition);
  const targetScenePosition = targetPosition.length >= 3
    ? targetPosition
    : liftPositionTo3D(targetPosition);
  const cordPoints = buildUwbCordPoints(
    sourceScenePosition,
    targetScenePosition,
    sigmaM,
    timeSeconds,
    sourceId,
    targetId
  );
  const geometry = new BufferGeometry().setFromPoints(
    cordPoints.map((point) => toVector3(point, -0.01))
  );
  const link = new Line(geometry, createViewerMaterials().uwbLink);
  link.renderOrder = 10;
  return link;
}
