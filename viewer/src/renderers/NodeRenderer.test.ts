import { LineBasicMaterial, LineSegments } from "three";
import { describe, expect, it } from "vitest";

import { layerStyles } from "../style/layerStyles";
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

  it("renders truth cross markers in fully opaque pitch black", () => {
    const marker = createNodeObject([0, 0, 0], layerStyles.truth.marker);

    expect(marker).toBeInstanceOf(LineSegments);
    const truthMarker = marker as LineSegments;
    const material = truthMarker.material as LineBasicMaterial;

    expect(material.color.getHexString()).toBe("000000");
    expect(material.opacity).toBe(1);
  });
});
