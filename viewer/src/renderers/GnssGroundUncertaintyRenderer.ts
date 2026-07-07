import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry
} from "three";

import { layerStyles } from "../style/layerStyles";
import { toVector3 } from "../utils/geometry";

const radialSegmentCount = 32;
const centerOpacity = 0.22;
const edgeOpacity = 0.035;

function smoothstep(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  const smoothed = clamped * clamped * (3 - 2 * clamped);
  return smoothed;
}

function baseOpacityForRadius(radiusRatio: number): number {
  const falloff = smoothstep(radiusRatio);
  const opacity = centerOpacity + (edgeOpacity - centerOpacity) * falloff;
  return opacity;
}

function makeRingMaterial(radiusRatio: number): MeshBasicMaterial {
  const opacity = baseOpacityForRadius(radiusRatio);
  const material = new MeshBasicMaterial({
    color: layerStyles.truth.line.color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: DoubleSide
  });
  return material;
}

export function createGnssGroundUncertainty(position: number[],
                                            sigmaM: number): Group {
  const safeSigmaM = Math.max(sigmaM, 0.001);
  const uncertainty = new Group();
  let innerRadiusM = 0;

  for (let segmentIndex = 0; segmentIndex < radialSegmentCount; segmentIndex += 1) {
    const outerRatio = (segmentIndex + 1) / radialSegmentCount;
    const opacityRatio = (segmentIndex + 0.5) / radialSegmentCount;
    const outerRadiusM = safeSigmaM * outerRatio;
    const geometry = new RingGeometry(innerRadiusM, outerRadiusM, 72).rotateX(-Math.PI / 2);
    const ring = new Mesh(geometry, makeRingMaterial(opacityRatio));
    ring.renderOrder = layerStyles.gnssUncertainty.renderOrder;
    uncertainty.add(ring);
    innerRadiusM = outerRadiusM;
  }

  uncertainty.position.copy(toVector3(position, 0.004));
  return uncertainty;
}
