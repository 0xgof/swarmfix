import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  Vector3
} from "three";

import { layerStyles } from "../style/layerStyles";
import { toVector3 } from "../utils/geometry";

const bellHeightM = 0.85;
const footprintSigmaMultiplier = 2.2;

function gaussianHeight(radiusM: number,
                        sigmaM: number): number {
  const normalizedRadius = radiusM / Math.max(sigmaM, 1e-6);
  const heightM = bellHeightM * Math.exp(-0.5 * normalizedRadius * normalizedRadius);
  return heightM;
}

function buildBellSurfaceGeometry(sigmaM: number): BufferGeometry {
  const radialSegments = 16;
  const angularSegments = 48;
  const safeSigmaM = Math.max(sigmaM, 0.001);
  const maxRadiusM = safeSigmaM * footprintSigmaMultiplier;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let radialIndex = 0; radialIndex <= radialSegments; radialIndex += 1) {
    const radiusM = maxRadiusM * radialIndex / radialSegments;
    const y = gaussianHeight(radiusM, safeSigmaM);
    for (let angularIndex = 0; angularIndex <= angularSegments; angularIndex += 1) {
      const angle = angularIndex / angularSegments * Math.PI * 2;
      positions.push(
        Math.cos(angle) * radiusM,
        y,
        Math.sin(angle) * radiusM
      );
    }
  }

  const rowLength = angularSegments + 1;
  for (let radialIndex = 0; radialIndex < radialSegments; radialIndex += 1) {
    for (let angularIndex = 0; angularIndex < angularSegments; angularIndex += 1) {
      const first = radialIndex * rowLength + angularIndex;
      const second = first + rowLength;
      indices.push(first, second, first + 1);
      indices.push(second, second + 1, first + 1);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildContourRing(sigmaM: number,
                          multiplier: number,
                          material: LineDashedMaterial): LineLoop {
  const safeSigmaM = Math.max(sigmaM, 0.001);
  const radiusM = safeSigmaM * multiplier;
  const y = gaussianHeight(radiusM, safeSigmaM);
  const points: Vector3[] = [];

  for (let index = 0; index < 72; index += 1) {
    const angle = index / 72 * Math.PI * 2;
    points.push(new Vector3(
      Math.cos(angle) * radiusM,
      y + 0.003,
      Math.sin(angle) * radiusM
    ));
  }

  const ring = new LineLoop(new BufferGeometry().setFromPoints(points), material.clone());
  ring.computeLineDistances();
  return ring;
}

function buildOutlineCurve(sigmaM: number,
                           rotationYRad: number,
                           material: LineBasicMaterial): Line {
  const safeSigmaM = Math.max(sigmaM, 0.001);
  const maxRadiusM = safeSigmaM * footprintSigmaMultiplier;
  const points: Vector3[] = [];

  for (let index = 0; index <= 32; index += 1) {
    const t = index / 32;
    const radiusM = maxRadiusM * (t * 2 - 1);
    const y = gaussianHeight(Math.abs(radiusM), safeSigmaM) + 0.006;
    points.push(new Vector3(radiusM, y, 0));
  }

  const outlineCurve = new Line(
    new BufferGeometry().setFromPoints(points),
    material.clone()
  );
  outlineCurve.rotation.y = rotationYRad;
  return outlineCurve;
}

export function createGnssBell(position: number[],
                               sigmaM: number): Group {
  const bell = new Group();
  const surfaceMaterial = new MeshBasicMaterial({
    color: layerStyles.gnssUncertainty.marker.color,
    transparent: true,
    opacity: layerStyles.gnssUncertainty.opacity,
    depthWrite: false,
    side: DoubleSide
  });
  const ringMaterial = new LineDashedMaterial({
    color: layerStyles.gnssMeasurement.line.color,
    transparent: true,
    opacity: layerStyles.gnssMeasurement.line.opacity,
    dashSize: 0.08,
    gapSize: 0.05
  });
  const outlineMaterial = new LineBasicMaterial({
    color: layerStyles.truth.line.color,
    transparent: true,
    opacity: layerStyles.truth.line.opacity
  });
  const surface = new Mesh(buildBellSurfaceGeometry(sigmaM), surfaceMaterial);
  bell.add(surface);

  for (const multiplier of [0.5, 1, 1.5, 2]) {
    bell.add(buildContourRing(sigmaM, multiplier, ringMaterial));
  }
  bell.add(buildOutlineCurve(sigmaM, 0, outlineMaterial));
  bell.add(buildOutlineCurve(sigmaM, Math.PI / 2, outlineMaterial));

  bell.position.copy(toVector3(position, 0));
  return bell;
}
