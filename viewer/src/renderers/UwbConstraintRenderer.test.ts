import { describe, expect, it } from "vitest";

import { buildUwbConstraintVisualModel } from "./UwbConstraintRenderer";

describe("UWB constraint visual model", () => {
  it("renders weak one-link UWB as an ambiguous range shell, not a position", () => {
    const model = buildUwbConstraintVisualModel({
      agentId: "agent_0",
      selectedUwbDegree: 1,
      constraintState: "weak_uwb",
      connectedDistancesM: [5],
      sigmaM: 0.3
    });

    expect(model.kind).toBe("range_shell");
    expect(model.radiusM).toBe(5);
    expect(model.vibrationAmplitudeM).toBeGreaterThan(0.3);
    expect(model).not.toHaveProperty("positionM");
  });

  it("renders multi-link UWB as triangulated constraint support", () => {
    const model = buildUwbConstraintVisualModel({
      agentId: "agent_0",
      selectedUwbDegree: 3,
      constraintState: "multi_uwb",
      connectedDistancesM: [4, 5, 6],
      sigmaM: 0.1
    });

    expect(model.kind).toBe("triangulated_support");
    expect(model.radiusM).toBeNull();
  });

  it("renders no selected UWB as absent constraint support", () => {
    const model = buildUwbConstraintVisualModel({
      agentId: "agent_0",
      selectedUwbDegree: 0,
      constraintState: "no_uwb",
      connectedDistancesM: [],
      sigmaM: 0.1
    });

    expect(model.kind).toBe("none");
  });
});
