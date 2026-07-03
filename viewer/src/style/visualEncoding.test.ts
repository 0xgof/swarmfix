import { describe, expect, it } from "vitest";

import { createViewerMaterials } from "./createMaterials";
import { layerStyles } from "./layerStyles";
import {
  encodeCostContribution,
  encodeGnssSigmaRadius,
  encodeResidualStress
} from "./visualEncoding";
import { visualTokens } from "./visualTokens";

describe("viewer visual style system", () => {
  it("defines semantic styles for every planned viewer layer", () => {
    expect(layerStyles.truth.marker.color).toBe("#000000");
    expect(layerStyles.uwbLink.renderOrder).toBeLessThan(
      layerStyles.fusedEstimate.renderOrder
    );
    expect(layerStyles.gnssUncertainty.opacity).toBeLessThan(0.25);
    expect(layerStyles.reference.marker.shape).toBe("diamond");
  });

  it("encodes residual stress deterministically without rainbow scales", () => {
    const smallResidual = encodeResidualStress(0.05, 1.0);
    const largeResidual = encodeResidualStress(2.0, 1.0);

    expect(smallResidual.color).toBe(visualTokens.color.red);
    expect(layerStyles.gnssResidual.line.color).toBe(visualTokens.color.red);
    expect(layerStyles.uwbResidual.line.color).toBe(visualTokens.color.red);
    expect(layerStyles.referenceResidual.line.color).toBe(visualTokens.color.red);
    expect(largeResidual.opacity).toBeGreaterThan(smallResidual.opacity);
    expect(largeResidual.lineWidth).toBeGreaterThan(smallResidual.lineWidth);
  });

  it("encodes uncertainty and cost without mutating style tokens", () => {
    const originalBlack = visualTokens.color.black;

    expect(encodeGnssSigmaRadius(1.5)).toBeCloseTo(1.5);
    expect(encodeCostContribution(4, 8).opacity).toBeGreaterThan(
      encodeCostContribution(1, 8).opacity
    );
    expect(visualTokens.color.black).toBe(originalBlack);
  });

  it("creates fresh materials without mutating shared styles", () => {
    const firstMaterials = createViewerMaterials();
    const secondMaterials = createViewerMaterials();

    expect(firstMaterials.truth).not.toBe(secondMaterials.truth);
    expect(layerStyles.truth.marker.color).toBe("#000000");
    expect(firstMaterials.residual.color.getHexString()).toBe("c9362c");
  });
});
