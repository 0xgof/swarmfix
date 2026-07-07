import { BufferGeometry, Line } from "three";

import { createViewerMaterials } from "../style/createMaterials";
import { toVector3 } from "../utils/geometry";

export function createResidualVector(from: number[],
                                     to: number[]): Line {
  const geometry = new BufferGeometry().setFromPoints([
    toVector3(from, 0.05),
    toVector3(to, 0.05)
  ]);
  const vector = new Line(geometry, createViewerMaterials().residual);
  return vector;
}
