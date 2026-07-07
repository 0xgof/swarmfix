import { describe, expect, it } from "vitest";

import type { Position3D } from "../animation/liveMotion";
import type { LiveSolveResponse } from "../live/liveSolveTypes";
import type { LiveEstimationFrame } from "../simulation/liveEstimation";
import { defaultMissionActionState } from "../simulation/missionActions";
import { DisplayFrameSmoother } from "./DisplayFrameSmoother";

function liveFrameFrom(
  truth: Array<[string, Position3D]>,
  gnss: Array<[string, Position3D]> = truth
): LiveEstimationFrame {
  const frame: LiveEstimationFrame = {
    truthPositions: new Map(truth),
    gnssPositions: new Map(gnss),
    gnssSigma: new Map(gnss.map(([agentId]) => [agentId, 1])),
    uwbLinks: [],
    uwbSelection: {
      candidateLinkCount: 0,
      selectedLinkCount: 0,
      maxLinksPerAgent: 0,
      connectedComponentCount: 0,
      isolatedAgentCount: 0,
      triangleCount: 0,
      addedLinks: 0,
      droppedLinks: 0,
      selectionPolicy: "adaptive_range_graph_v1",
      adaptiveSelectionEnabled: true
    }
  };
  return frame;
}

function displayFrameFrom(
  fused: Array<[string, Position3D]>,
  selectedUwbCount = 0
): LiveSolveResponse {
  const response: LiveSolveResponse = {
    schema_version: "0.1.0",
    metadata: { solver: "test", selected_uwb_count: selectedUwbCount },
    truth: fused.map(([agentId, position]) => ({
      agent_id: agentId,
      position_m: position
    })),
    measurements: { gnss: [], uwb: [] },
    estimates: {
      fused: fused.map(([agentId, position]) => ({
        agent_id: agentId,
        position_m: position
      })),
      gnss_only: []
    },
    trace: {
      trace_type: "live_solve",
      iterations: [{
        iteration: 0,
        positions: Object.fromEntries(fused),
        cost_total: 7,
        cost_gnss: 3,
        cost_uwb: 4,
        gnss_residuals: [{
          agent_id: "agent_0",
          vector: [1, 0, 0],
          norm: 1,
          weighted_sq: 7
        }],
        uwb_residuals: []
      }]
    },
    constraints: { nodes: [], edges: [] }
  };
  return response;
}

function updateInput(overrides: Partial<Parameters<DisplayFrameSmoother["update"]>[0]> = {}):
    Parameters<DisplayFrameSmoother["update"]>[0] {
  const missionAction = defaultMissionActionState();
  const input = {
    liveFrame: liveFrameFrom([["agent_0", [0, 0, 0]]]),
    displayFrame: displayFrameFrom([["agent_0", [0, 0, 0]]]),
    missionAction,
    missionDroneCount: 1,
    selectedUwbLinkCount: 0,
    latestSolvedFrameAgeMs: 0,
    recentFrameWasSlow: false,
    nowMs: 0,
    ...overrides
  };
  return input;
}

describe("DisplayFrameSmoother", () => {
  it("passes stable frames through without interpolation lag", () => {
    const smoother = new DisplayFrameSmoother();
    const liveFrame = liveFrameFrom([["agent_0", [10, 0, 0]]]);

    const first = smoother.update(updateInput({ liveFrame, nowMs: 0 }));
    const second = smoother.update(updateInput({ liveFrame, nowMs: 16 }));

    expect(first.diagnostics.active).toBe(false);
    expect(second.diagnostics.active).toBe(false);
    expect(second.liveFrame.truthPositions.get("agent_0")).toEqual([10, 0, 0]);
    expect(second.displayPositions.fused).toBeUndefined();
  });

  it("smooths formation changes without dragging behind the target", () => {
    const smoother = new DisplayFrameSmoother();
    const gridAction = defaultMissionActionState();
    const lineAction = { ...gridAction, formation: "line" as const };
    smoother.update(updateInput({
      liveFrame: liveFrameFrom([["agent_0", [0, 0, 0]]]),
      missionAction: gridAction,
      nowMs: 0
    }));

    const during = smoother.update(updateInput({
      liveFrame: liveFrameFrom([["agent_0", [22, 0, 0]]]),
      missionAction: lineAction,
      nowMs: 0
    }));
    const catchingUp = smoother.update(updateInput({
      liveFrame: liveFrameFrom([["agent_0", [22, 0, 0]]]),
      missionAction: lineAction,
      nowMs: 80
    }));
    const settled = smoother.update(updateInput({
      liveFrame: liveFrameFrom([["agent_0", [22, 0, 0]]]),
      missionAction: lineAction,
      nowMs: 120
    }));

    expect(during.diagnostics).toMatchObject({
      active: true,
      reason: "formation_change",
      windowMs: 120
    });
    expect(during.liveFrame.truthPositions.get("agent_0")?.[0]).toBeLessThan(22);
    expect(catchingUp.liveFrame.truthPositions.get("agent_0")?.[0]).toBeGreaterThan(18);
    expect(settled.liveFrame.truthPositions.get("agent_0")).toEqual([22, 0, 0]);
    expect(settled.diagnostics.active).toBe(false);
  });

  it("introduces added drones from the nearest previous rendered position", () => {
    const smoother = new DisplayFrameSmoother();
    smoother.update(updateInput({
      liveFrame: liveFrameFrom([
        ["agent_0", [0, 0, 0]],
        ["agent_1", [10, 0, 0]]
      ]),
      missionDroneCount: 2,
      nowMs: 0
    }));

    const during = smoother.update(updateInput({
      liveFrame: liveFrameFrom([
        ["agent_0", [0, 0, 0]],
        ["agent_1", [10, 0, 0]],
        ["agent_2", [12, 0, 0]]
      ]),
      missionDroneCount: 3,
      nowMs: 16
    }));

    expect(during.diagnostics.reason).toBe("drone_count_change");
    expect(during.diagnostics.windowMs).toBe(180);
    expect(during.liveFrame.truthPositions.get("agent_2")?.[0]).toBeGreaterThan(10);
    expect(during.liveFrame.truthPositions.get("agent_2")?.[0]).toBeLessThan(12);
  });

  it("removes absent drones immediately instead of leaving stale active agents", () => {
    const smoother = new DisplayFrameSmoother();
    smoother.update(updateInput({
      liveFrame: liveFrameFrom([
        ["agent_0", [0, 0, 0]],
        ["agent_1", [10, 0, 0]]
      ]),
      missionDroneCount: 2,
      nowMs: 0
    }));

    const during = smoother.update(updateInput({
      liveFrame: liveFrameFrom([["agent_0", [0, 0, 0]]]),
      missionDroneCount: 1,
      nowMs: 16
    }));

    expect(during.liveFrame.truthPositions.has("agent_1")).toBe(false);
  });

  it("smooths selected-UWB topology jumps without changing diagnostics", () => {
    const smoother = new DisplayFrameSmoother();
    smoother.update(updateInput({
      liveFrame: liveFrameFrom([["agent_0", [0, 0, 0]]]),
      selectedUwbLinkCount: 1,
      nowMs: 0
    }));
    const targetFrame = liveFrameFrom([["agent_0", [20, 0, 0]]]);
    targetFrame.uwbSelection.selectedLinkCount = 8;
    targetFrame.uwbSelection.candidateLinkCount = 12;

    const during = smoother.update(updateInput({
      liveFrame: targetFrame,
      selectedUwbLinkCount: 8,
      nowMs: 16
    }));

    expect(during.diagnostics.reason).toBe("topology_change");
    expect(during.liveFrame.uwbSelection).toBe(targetFrame.uwbSelection);
    expect(during.liveFrame.truthPositions.get("agent_0")?.[0]).toBeLessThan(20);
  });

  it("does not alter solver evidence while smoothing display positions", () => {
    const smoother = new DisplayFrameSmoother();
    const displayFrame = displayFrameFrom([["agent_0", [0, 0, 0]]], 1);
    smoother.update(updateInput({ displayFrame, selectedUwbLinkCount: 1, nowMs: 0 }));
    const nextDisplayFrame = displayFrameFrom([["agent_0", [10, 0, 0]]], 8);

    const during = smoother.update(updateInput({
      displayFrame: nextDisplayFrame,
      selectedUwbLinkCount: 8,
      nowMs: 16
    }));

    expect(nextDisplayFrame.trace.iterations[0].cost_total).toBe(7);
    expect(nextDisplayFrame.trace.iterations[0].gnss_residuals[0].weighted_sq).toBe(7);
    expect(during.displayPositions.fused?.get("agent_0")?.[0]).toBeLessThan(10);
    expect(during.displayPositions.fused?.get("agent_0")?.[0]).toBeGreaterThan(0);
  });
});
