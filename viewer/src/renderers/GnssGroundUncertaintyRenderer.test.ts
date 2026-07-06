import { Box3, Group, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { createGnssGroundUncertainty } from "./GnssGroundUncertaintyRenderer";

function ringMeshesForSigma(sigmaM: number): Mesh[] {
  const uncertainty = createGnssGroundUncertainty([0, 0, 0], sigmaM);
  const ringMeshes = uncertainty.children.filter((child): child is Mesh => (
    child instanceof Mesh
  ));
  return ringMeshes;
}

describe("createGnssGroundUncertainty", () => {
  it("renders filled concentric uncertainty rings flat on the ground plane", () => {
    const uncertainty = createGnssGroundUncertainty([0, 0, 0], 1);
    const ringMeshes = ringMeshesForSigma(1);

    expect(uncertainty).toBeInstanceOf(Group);
    expect(ringMeshes.length).toBeGreaterThan(24);
    for (const ring of ringMeshes) {
      const ringSize = new Box3().setFromObject(ring).getSize(new Vector3());
      expect(ringSize.y).toBeLessThan(0.01);
      expect(ringSize.x).toBeGreaterThan(0);
      expect(ringSize.z).toBeGreaterThan(0);
    }
  });

  it("softens filled ring edges from a dark center toward the one sigma edge", () => {
    const ringMeshes = ringMeshesForSigma(1);
    const opacities = ringMeshes.map((ring) => (
      (ring.material as MeshBasicMaterial).opacity
    ));

    expect(opacities[0]).toBeLessThanOrEqual(0.24);
    expect(opacities[opacities.length - 1]).toBeLessThanOrEqual(0.04);
    for (let index = 1; index < opacities.length; index += 1) {
      expect(opacities[index]).toBeLessThan(opacities[index - 1]);
      expect(opacities[index - 1] - opacities[index]).toBeLessThan(0.01);
    }
  });

  it("uses GNSS sigma as the outer standard circle radius", () => {
    const narrow = createGnssGroundUncertainty([0, 0, 0], 0.5);
    const wide = createGnssGroundUncertainty([0, 0, 0], 2);
    const narrowSize = new Box3().setFromObject(narrow).getSize(new Vector3());
    const wideSize = new Box3().setFromObject(wide).getSize(new Vector3());

    expect(wideSize.x).toBeCloseTo(narrowSize.x * 4, 5);
    expect(wideSize.z).toBeCloseTo(narrowSize.z * 4, 5);
  });
});
