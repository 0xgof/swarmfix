import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments
} from "three";

import { visualTokens } from "../style/visualTokens";

const gridSize = 320;
const gridDivisions = 160;
const crossArmM = 0.07;
const edgeGapM = 0.45;
const crossOpacity = 0.3;
const edgeOpacity = 0.07;

function lineSegmentsFromPoints(points: number[],
                                name: string,
                                opacity: number): LineSegments {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
  const material = new LineBasicMaterial({
    color: visualTokens.color.black,
    transparent: true,
    opacity
  });
  const segments = new LineSegments(geometry, material);
  segments.name = name;
  return segments;
}

function buildCrossPoints(): number[] {
  const halfSize = gridSize / 2;
  const cellSize = gridSize / gridDivisions;
  const points: number[] = [];

  for (let column = 0; column <= gridDivisions; column += 1) {
    for (let row = 0; row <= gridDivisions; row += 1) {
      const x = -halfSize + column * cellSize;
      const z = -halfSize + row * cellSize;
      points.push(x - crossArmM, 0, z, x + crossArmM, 0, z);
      points.push(x, 0, z - crossArmM, x, 0, z + crossArmM);
    }
  }

  return points;
}

function buildEdgePoints(): number[] {
  const halfSize = gridSize / 2;
  const cellSize = gridSize / gridDivisions;
  const points: number[] = [];

  for (let lineIndex = 0; lineIndex <= gridDivisions; lineIndex += 1) {
    const fixed = -halfSize + lineIndex * cellSize;
    for (let cell = 0; cell < gridDivisions; cell += 1) {
      const start = -halfSize + cell * cellSize + edgeGapM;
      const end = -halfSize + (cell + 1) * cellSize - edgeGapM;
      points.push(start, 0, fixed, end, 0, fixed);
      points.push(fixed, 0, start, fixed, 0, end);
    }
  }

  return points;
}

export function createGrid(): Group {
  const floor = new Group();
  floor.name = "floor-grid";
  floor.add(lineSegmentsFromPoints(buildCrossPoints(), "grid-crosses", crossOpacity));
  floor.add(lineSegmentsFromPoints(buildEdgePoints(), "grid-edges", edgeOpacity));
  return floor;
}
