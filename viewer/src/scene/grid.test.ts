import { describe, expect, it } from "vitest";

import { LineBasicMaterial, LineSegments } from "three";

import { visualTokens } from "../style/visualTokens";
import { createGrid } from "./grid";

const gridSize = 320;
const gridDivisions = 160;
const cellSize = gridSize / gridDivisions;
const intersectionCount = (gridDivisions + 1) * (gridDivisions + 1);

function distanceToNearestIntersection(coordinate: number): number {
  const nearest = Math.round(coordinate / cellSize) * cellSize;
  return Math.abs(coordinate - nearest);
}

function segmentsByName(name: string): LineSegments {
  const grid = createGrid();
  const segments = grid.getObjectByName(name);
  expect(segments).toBeInstanceOf(LineSegments);
  return segments as LineSegments;
}

function segmentEndpoints(segments: LineSegments): number[][] {
  const positions = segments.geometry.getAttribute("position");
  const endpoints: number[][] = [];
  for (let index = 0; index < positions.count; index += 1) {
    endpoints.push([
      positions.getX(index),
      positions.getY(index),
      positions.getZ(index)
    ]);
  }
  return endpoints;
}

describe("viewer floor grid", () => {
  it("draws a thin black cross at every grid intersection", () => {
    const crosses = segmentsByName("grid-crosses");

    // Two segments (4 vertices) per intersection: one along x, one along z.
    const positions = crosses.geometry.getAttribute("position");
    expect(positions.count).toBe(intersectionCount * 4);
    const material = crosses.material as LineBasicMaterial;
    expect(`#${material.color.getHexString()}`).toBe(visualTokens.color.black);
  });

  it("keeps cross arms short relative to the cell size", () => {
    const crosses = segmentsByName("grid-crosses");
    const endpoints = segmentEndpoints(crosses);

    for (const [x, , z] of endpoints) {
      const armLength = Math.max(
        distanceToNearestIntersection(x),
        distanceToNearestIntersection(z)
      );
      expect(armLength).toBeLessThan(cellSize * 0.08);
    }
  });

  it("ends edge segments before they touch the intersections", () => {
    const edges = segmentsByName("grid-edges");
    const endpoints = segmentEndpoints(edges);
    expect(endpoints.length).toBeGreaterThan(0);

    for (const [x, , z] of endpoints) {
      const distanceToIntersection = Math.max(
        distanceToNearestIntersection(x),
        distanceToNearestIntersection(z)
      );
      // Every edge endpoint must stay clearly away from the nearest
      // intersection so the cross marks breathe.
      expect(distanceToIntersection).toBeGreaterThan(0.3);
    }
    const material = edges.material as LineBasicMaterial;
    expect(`#${material.color.getHexString()}`).toBe(visualTokens.color.black);
  });

  it("keeps the floor flat on the ground plane", () => {
    const crosses = segmentsByName("grid-crosses");
    for (const [, y] of segmentEndpoints(crosses)) {
      expect(y).toBe(0);
    }
  });
});
