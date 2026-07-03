import { BufferGeometry, Line } from "three";

import { createViewerMaterials } from "../style/createMaterials";
import { toVector3 } from "../utils/geometry";

function distanceBetween(firstPosition: number[],
                         secondPosition: number[]): number {
  const dimension = Math.max(firstPosition.length, secondPosition.length);
  let squaredDistance = 0;
  for (let index = 0; index < dimension; index += 1) {
    const delta = (firstPosition[index] ?? 0) - (secondPosition[index] ?? 0);
    squaredDistance += delta * delta;
  }

  const distanceM = Math.sqrt(squaredDistance);
  return distanceM;
}

export function createPositionErrorLine(agentId: string,
                                        truthPosition: number[],
                                        fusedPosition: number[]): Line {
  const geometry = new BufferGeometry().setFromPoints([
    toVector3(truthPosition, 0.12),
    toVector3(fusedPosition, 0.12)
  ]);
  const line = new Line(geometry, createViewerMaterials().residual);
  line.renderOrder = 30;
  line.userData = {
    kind: "position-error",
    agentId,
    errorM: distanceBetween(truthPosition, fusedPosition)
  };
  return line;
}
