import {
  BufferGeometry,
  DoubleSide,
  LineSegments,
  Mesh,
  Object3D,
  RingGeometry,
  SphereGeometry,
  Vector3
} from "three";

import type { MarkerStyle } from "../style/layerStyles";
import { createViewerMaterials } from "../style/createMaterials";
import { toVector3 } from "../utils/geometry";

export function createNodeObject(position: number[],
                                 style: MarkerStyle): Object3D {
  const materials = createViewerMaterials();
  if (style.shape === "cross") {
    const halfSize = style.size;
    const geometry = new BufferGeometry().setFromPoints([
      new Vector3(-halfSize, 0, 0),
      new Vector3(halfSize, 0, 0),
      new Vector3(0, -halfSize, 0),
      new Vector3(0, halfSize, 0),
      new Vector3(0, 0, -halfSize),
      new Vector3(0, 0, halfSize)
    ]);
    const crossMaterial = materials.residual.clone();
    crossMaterial.color.set(style.color);
    crossMaterial.opacity = style.opacity;
    crossMaterial.transparent = style.opacity < 1;
    const cross = new LineSegments(geometry, crossMaterial);
    cross.position.copy(toVector3(position, 0.08));
    return cross;
  }

  const geometry = style.shape === "ring"
    ? new RingGeometry(style.size * 0.55, style.size, 32).rotateX(-Math.PI / 2)
    : style.shape === "diamond"
      ? new SphereGeometry(style.size * 0.92, 12, 8)
      : new SphereGeometry(style.size, 16, 12);
  const node = new Mesh(geometry, materials.truth.clone());
  node.material.color.set(style.color);
  node.material.opacity = style.opacity;
  node.material.transparent = style.opacity < 1;
  if (style.shape === "ring") {
    node.material.side = DoubleSide;
  }
  node.position.copy(toVector3(position, 0.1));
  return node;
}
