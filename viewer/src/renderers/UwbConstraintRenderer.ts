import type { UwbConstraintState } from "../live/liveSolveTypes";

export interface UwbConstraintVisualInput {
  agentId: string;
  selectedUwbDegree: number;
  constraintState: UwbConstraintState;
  connectedDistancesM: number[];
  sigmaM: number;
}

export interface UwbConstraintVisualModel {
  agentId: string;
  kind: "none" | "range_shell" | "triangulated_support";
  radiusM: number | null;
  vibrationAmplitudeM: number;
}

export function buildUwbConstraintVisualModel(input: UwbConstraintVisualInput): UwbConstraintVisualModel {
  if (input.constraintState === "no_uwb" || input.selectedUwbDegree === 0) {
    const absentModel = {
      agentId: input.agentId,
      kind: "none" as const,
      radiusM: null,
      vibrationAmplitudeM: 0
    };
    return absentModel;
  }

  if (input.constraintState === "weak_uwb" || input.selectedUwbDegree === 1) {
    const radiusM = input.connectedDistancesM[0] ?? null;
    const weakConstraintModel = {
      agentId: input.agentId,
      kind: "range_shell" as const,
      radiusM,
      vibrationAmplitudeM: Math.max(input.sigmaM * 1.25, 0.05)
    };
    return weakConstraintModel;
  }

  const triangulatedModel = {
    agentId: input.agentId,
    kind: "triangulated_support" as const,
    radiusM: null,
    vibrationAmplitudeM: Math.max(input.sigmaM * 0.75, 0.02)
  };
  return triangulatedModel;
}
