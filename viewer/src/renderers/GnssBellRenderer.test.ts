import {
  Box3,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineLoop,
  Mesh,
  Vector3
} from "three";
import { describe, expect, it } from "vitest";

import { createGnssBell } from "./GnssBellRenderer";

function boundsForSigma(sigmaM: number): Vector3 {
  const bell = createGnssBell([0, 0, 0], sigmaM);
  const bellSize = new Box3().setFromObject(bell).getSize(new Vector3());
  return bellSize;
}

describe("createGnssBell", () => {
  it("renders a Gaussian bell glyph with a surface and contour rings", () => {
    const bell = createGnssBell([0, 0, 0], 1);

    expect(bell).toBeInstanceOf(Group);
    expect(bell.children.some((child) => child instanceof Mesh)).toBe(true);
    expect(bell.children.filter((child) => child instanceof LineLoop).length).toBeGreaterThan(2);
  });

  it("renders contour rings as dashed probability contours", () => {
    const bell = createGnssBell([0, 0, 0], 1);
    const contourRings = bell.children.filter((child) => child instanceof LineLoop);

    expect(contourRings.length).toBeGreaterThan(2);
    for (const contourRing of contourRings) {
      expect(contourRing.material).toBeInstanceOf(LineDashedMaterial);
      expect(contourRing.geometry.getAttribute("lineDistance")).toBeDefined();
    }
  });

  it("draws the bell silhouette with thin solid black outline curves", () => {
    const bell = createGnssBell([0, 0, 0], 1);
    const outlineCurves = bell.children.filter((child): child is Line => (
      child instanceof Line && !(child instanceof LineLoop)
    ));

    expect(outlineCurves).toHaveLength(2);
    for (const outlineCurve of outlineCurves) {
      expect(outlineCurve.material).toBeInstanceOf(LineBasicMaterial);
      const outlineMaterial = outlineCurve.material as LineBasicMaterial;
      expect(outlineMaterial.color.getHexString()).toBe("111111");
      expect(outlineCurve.geometry.getAttribute("position").count).toBeGreaterThan(8);
    }
  });

  it("uses GNSS sigma as the footprint width of the probability glyph", () => {
    const narrowBellSize = boundsForSigma(0.5);
    const wideBellSize = boundsForSigma(2);

    expect(wideBellSize.x).toBeGreaterThan(narrowBellSize.x * 2);
    expect(wideBellSize.z).toBeGreaterThan(narrowBellSize.z * 2);
  });

  it("keeps the visual bell height bounded as sigma changes", () => {
    const narrowBellSize = boundsForSigma(0.5);
    const wideBellSize = boundsForSigma(2);

    expect(wideBellSize.y).toBeCloseTo(narrowBellSize.y, 5);
  });
});
