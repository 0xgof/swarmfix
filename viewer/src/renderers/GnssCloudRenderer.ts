import { Mesh, SphereGeometry } from "three";

import { createViewerMaterials } from "../style/createMaterials";
import { toVector3 } from "../utils/geometry";

export function createGnssCloud(position: number[],
                                radiusM: number): Mesh {
  const cloud = new Mesh(
    new SphereGeometry(radiusM, 32, 16),
    createViewerMaterials().gnssUncertainty
  );
  cloud.position.copy(toVector3(position, 0));
  return cloud;
}
