import { LineSegments } from "three";
import { describe, expect, it } from "vitest";

import { createNodeObject } from "./NodeRenderer";

describe("createNodeObject", () => {
  it("renders cross markers as orthogonal x, y, and z handles", () => {
    const marker = createNodeObject([0, 0, 0], {
      color: "#000000",
      opacity: 1,
      size: 0.5,
      shape: "cross"
    });

    expect(marker).toBeInstanceOf(LineSegments);
    const crossMarker = marker as LineSegments;
    const positions = Array.from(
      crossMarker.geometry.getAttribute("position").array
    );
    expect(positions).toEqual([
      -0.5, 0, 0,
      0.5, 0, 0,
      0, -0.5, 0,
      0, 0.5, 0,
      0, 0, -0.5,
      0, 0, 0.5
    ]);
  });
});
