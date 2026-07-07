import { describe, expect, it } from "vitest";

import {
  buildFormationElements,
  highlightForSelection
} from "./formationSelection";
import { buildNormalSystemSnapshot } from "./normalSystemModel";
import type { LiveSolveRequest } from "../live/liveSolveTypes";

const request: LiveSolveRequest = {
  schema_version: "0.1.0",
  dimension: 3,
  agents: [
    { agent_id: "agent_0", position_m: [0, 0, 0] },
    { agent_id: "agent_1", position_m: [2, 0, 0] }
  ],
  gnss: [
    { agent_id: "agent_0", position_m: [0.5, 0, 0], sigma_m: 2 },
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

describe("formation selection mapping", () => {
  it("builds static drone, GNSS, and UWB elements from a request", () => {
    const elements = buildFormationElements(request);

    expect(elements.drones.map((drone) => drone.agentId)).toEqual(["agent_0", "agent_1"]);
    expect(elements.gnssMarkers.map((marker) => marker.agentId)).toEqual(["agent_0", "agent_1"]);
    expect(elements.uwbLinks).toEqual([{
      key: "agent_0::agent_1",
      sourceId: "agent_0",
      targetId: "agent_1"
    }]);
  });

  it("maps a selected drone to that agent's coordinate columns", () => {
    const snapshot = buildNormalSystemSnapshot(request);

    const highlight = highlightForSelection(snapshot, {
      kind: "drone",
      agentId: "agent_1"
    });

    expect(highlight.columns).toEqual(new Set([3, 4, 5]));
    expect(highlight.rows.size).toBe(0);
  });

  it("maps a selected GNSS marker to GNSS rows and coordinate columns", () => {
    const snapshot = buildNormalSystemSnapshot(request);

    const highlight = highlightForSelection(snapshot, {
      kind: "gnss",
      agentId: "agent_0"
    });

    expect(highlight.rows).toEqual(new Set([0, 1, 2]));
    expect(highlight.columns).toEqual(new Set([0, 1, 2]));
  });

  it("maps a selected UWB link to its UWB row and endpoint columns", () => {
    const snapshot = buildNormalSystemSnapshot(request);

    const highlight = highlightForSelection(snapshot, {
      kind: "uwb",
      sourceId: "agent_0",
      targetId: "agent_1"
    });

    expect(highlight.rows).toEqual(new Set([6]));
    expect(highlight.columns).toEqual(new Set([0, 1, 2, 3, 4, 5]));
  });
});
