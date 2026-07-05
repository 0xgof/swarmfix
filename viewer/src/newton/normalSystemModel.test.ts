import { describe, expect, it } from "vitest";

import {
  buildNormalSystemSnapshot,
  stepNormalSystem
} from "./normalSystemModel";
import type { LiveSolveRequest } from "../live/liveSolveTypes";

const request: LiveSolveRequest = {
  schema_version: "0.1.0",
  dimension: 3,
  agents: [
    { agent_id: "agent_0", position_m: [0, 0, 0] },
    { agent_id: "agent_1", position_m: [2, 0, 0] }
  ],
  gnss: [
    { agent_id: "agent_0", position_m: [0, 0, 0], sigma_m: 2 },
    { agent_id: "agent_1", position_m: [4, 0, 0], sigma_m: 2 }
  ],
  uwb: [{
    source_id: "agent_0",
    target_id: "agent_1",
    distance_m: 5,
    sigma_m: 0.5,
    true_distance_m: null
  }],
  selected_uwb_links: [{ source_id: "agent_0", target_id: "agent_1" }],
  estimation: { max_iterations: 40, robust_loss: "linear" }
};

describe("normal system model", () => {
  it("builds labeled residual rows and variable columns from a live request", () => {
    const snapshot = buildNormalSystemSnapshot(request);

    expect(snapshot.residualRows).toHaveLength(7);
    expect(snapshot.variableColumns).toEqual([
      { agentId: "agent_0", coordinate: "x" },
      { agentId: "agent_0", coordinate: "y" },
      { agentId: "agent_0", coordinate: "z" },
      { agentId: "agent_1", coordinate: "x" },
      { agentId: "agent_1", coordinate: "y" },
      { agentId: "agent_1", coordinate: "z" }
    ]);
  });

  it("uses one scaled identity entry for each GNSS Jacobian row", () => {
    const snapshot = buildNormalSystemSnapshot(request);

    expect(snapshot.jacobian[0]).toEqual([0.5, 0, 0, 0, 0, 0]);
    expect(snapshot.jacobian[3]).toEqual([0, 0, 0, 0.5, 0, 0]);
  });

  it("uses source and target unit-vector derivatives for UWB rows", () => {
    const snapshot = buildNormalSystemSnapshot(request);
    const uwbRow = snapshot.jacobian[6];

    expect(uwbRow).toEqual([-2, 0, 0, 2, 0, 0]);
    expect(snapshot.residualVector[6]).toBe(-6);
  });

  it("builds normal matrix, gradient, rhs, and damping from direct products", () => {
    const snapshot = buildNormalSystemSnapshot(request, { damping: 0.25 });

    expect(snapshot.normalMatrix[0][0]).toBeCloseTo(4.25);
    expect(snapshot.normalMatrix[0][3]).toBeCloseTo(-4);
    expect(snapshot.normalMatrix[3][0]).toBeCloseTo(-4);
    expect(snapshot.normalMatrix[3][3]).toBeCloseTo(4.25);
    expect(snapshot.gradient[0]).toBeCloseTo(12);
    expect(snapshot.gradient[3]).toBeCloseTo(-12.5);
    expect(snapshot.rhs[0]).toBeCloseTo(-12);
    expect(snapshot.rhs[3]).toBeCloseTo(12.5);
    expect(snapshot.dampedNormalMatrix[0][0]).toBeCloseTo(4.5);
    expect(snapshot.dampedNormalMatrix[0][3]).toBeCloseTo(-4);
  });

  it("accepts a diagnostic step when it lowers weighted cost", () => {
    const step = stepNormalSystem(request, { damping: 0.25 });

    expect(step.accepted).toBe(true);
    expect(step.costAfter).toBeLessThan(step.costBefore);
    expect(step.delta.length).toBe(6);
  });
});
