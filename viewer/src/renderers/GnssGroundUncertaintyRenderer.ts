import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry
} from "three";

import { layerStyles } from "../style/layerStyles";
import { toVector3 } from "../utils/geometry";

const ringMultipliers = [0.25, 0.5, 0.75, 1.0];

function baseOpacityForRing(index: number,
                            ringCount: number): number {
  const opacityStep = ringCount <= 1 ? 1 : index / (ringCount - 1);
  const opacity = 0.22 - opacityStep * 0.17;
  return opacity;
}

function makeRingMaterial(index: number,
                          ringCount: number): MeshBasicMaterial {
  const opacity = baseOpacityForRing(index, ringCount);
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

  ringMultipliers.forEach((multiplier, index) => {
    const outerRadiusM = safeSigmaM * multiplier;
    const geometry = new RingGeometry(innerRadiusM, outerRadiusM, 72).rotateX(-Math.PI / 2);
    const ring = new Mesh(geometry, makeRingMaterial(index, ringMultipliers.length));
    ring.renderOrder = layerStyles.gnssUncertainty.renderOrder;
    uncertainty.add(ring);
    innerRadiusM = outerRadiusM;
  });

  uncertainty.position.copy(toVector3(position, 0.004));
  return uncertainty;
}
