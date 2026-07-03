import { visualTokens } from "./visualTokens";

export interface EncodedLine {
  color: string;
  opacity: number;
  lineWidth: number;
}

export interface EncodedArea {
  color: string;
  opacity: number;
  radius: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const clampedValue = Math.min(1, Math.max(0, value));
  return clampedValue;
}

export function encodeResidualStress(residualMagnitude: number,
                                     sigmaM: number): EncodedLine {
  const safeSigmaM = Math.max(sigmaM, 1e-9);
  const normalizedResidual = Math.abs(residualMagnitude) / safeSigmaM;
  const stress = clamp01(normalizedResidual / 3);
  const opacity = visualTokens.opacity.subtle
    + stress * (visualTokens.opacity.strong - visualTokens.opacity.subtle);
  const lineWidth = visualTokens.lineWidth.hairline
    + stress * (visualTokens.lineWidth.heavy - visualTokens.lineWidth.hairline);
  const encodedResidual = {
    color: visualTokens.color.red,
    opacity,
    lineWidth
  };
  return encodedResidual;
}

export function encodeCostContribution(weightedSq: number,
                                       maxWeightedSq: number): EncodedArea {
  const normalizedCost = clamp01(weightedSq / Math.max(maxWeightedSq, 1e-9));
  const encodedCost = {
    color: visualTokens.color.charcoal,
    opacity: visualTokens.opacity.faint
      + normalizedCost * (visualTokens.opacity.medium - visualTokens.opacity.faint),
    radius: 0.08 + normalizedCost * 0.32
  };
  return encodedCost;
}

export function encodeGnssSigmaRadius(sigmaM: number): number {
  const radiusM = Math.max(0, sigmaM);
  return radiusM;
}
