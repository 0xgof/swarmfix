import { CircleGeometry, Mesh } from "three";

import { createViewerMaterials } from "../style/createMaterials";
import { encodeCostContribution } from "../style/visualEncoding";
import { toVector3 } from "../utils/geometry";

export function createCostGlyph(position: number[],
                                weightedSq: number,
                                maxWeightedSq: number): Mesh {
  const encodedCost = encodeCostContribution(weightedSq, maxWeightedSq);
  const glyph = new Mesh(
    new CircleGeometry(encodedCost.radius, 32),
    createViewerMaterials().gnssUncertainty
  );
  glyph.material.opacity = encodedCost.opacity;
  glyph.position.copy(toVector3(position, 0.02));
  return glyph;
}
