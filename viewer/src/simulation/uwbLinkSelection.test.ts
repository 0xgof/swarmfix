import { describe, expect, it } from "vitest";

import type { UwbMeasurement } from "../data/sceneTypes";
import type { Position3D } from "../animation/liveMotion";
import {
  selectLiveUwbLinks,
  stableUwbEndpointKey,
  type LiveUwbSelectionOptions
} from "./uwbLinkSelection";

const positions = new Map<string, Position3D>([
  ["agent_0", [0, 0, 0]],
  ["agent_1", [1, 0, 0]],
  ["agent_2", [0, 0, 1]],
  ["agent_3", [3, 0, 0]]
]);

const measurements: UwbMeasurement[] = [
  {
    source_id: "agent_0",
    target_id: "agent_3",
    measured_distance_m: 3,
    sigma_m: 0.3,
    true_distance_m: 3
  },
  {
    source_id: "agent_0",
    target_id: "agent_1",
    measured_distance_m: 1,
    sigma_m: 0.1,
    true_distance_m: 1
  },
  {
    source_id: "agent_1",
    target_id: "agent_2",
    measured_distance_m: Math.SQRT2,
    sigma_m: 0.1,
    true_distance_m: Math.SQRT2
  },
  {
    source_id: "agent_0",
    target_id: "agent_2",
    measured_distance_m: 1,
    sigma_m: 0.1,
    true_distance_m: 1
  }
];

const baseOptions: LiveUwbSelectionOptions = {
  maxLinksPerAgent: 2,
  maxRangeM: 2,
  addRangeM: 1.9,
  dropRangeM: 2.2,
  preferNearby: true,
  preferUnderconnectedAgents: true,
  preferTriangleClosure: true,
  maxGraphChangesPerFrame: 10
};

describe("adaptive live UWB link selection", () => {
  it("builds deterministic range-filtered candidates from live positions", () => {
    const selection = selectLiveUwbLinks({
      positions,
      measurements,
      options: baseOptions
    });

    expect(selection.candidates.map((candidate) => candidate.distanceM)).toEqual([
      1,
      1,
      Math.SQRT2
    ]);
    expect(selection.candidates.map((candidate) => candidate.key)).toEqual([
      "agent_0::agent_1",
      "agent_0::agent_2",
      "agent_1::agent_2"
    ]);
    expect(selection.diagnostics.candidateLinkCount).toBe(3);
  });

  it("prefers shorter links while respecting the per-agent degree cap", () => {
    const selection = selectLiveUwbLinks({
      positions,
      measurements,
      options: { ...baseOptions, maxLinksPerAgent: 1, maxRangeM: 4, addRangeM: 4 }
    });

    expect(selection.selectedLinks).toEqual([{
      sourceId: "agent_0",
      targetId: "agent_1",
      measuredDistanceM: 1,
      sigmaM: 0.1,
      selectionReason: "new"
    }]);
    expect(selection.diagnostics.selectedLinkCount).toBe(1);
  });

  it("prioritizes underconnected agents before densifying an existing pair", () => {
    const squarePositions = new Map<string, Position3D>([
      ["agent_0", [0, 0, 0]],
      ["agent_1", [1, 0, 0]],
      ["agent_2", [2, 0, 0]],
      ["agent_3", [3, 0, 0]]
    ]);
    const chainMeasurements: UwbMeasurement[] = [
      {
        source_id: "agent_0",
        target_id: "agent_1",
        measured_distance_m: 1,
        sigma_m: 0.1,
        true_distance_m: 1
      },
      {
        source_id: "agent_1",
        target_id: "agent_2",
        measured_distance_m: 1,
        sigma_m: 0.1,
        true_distance_m: 1
      },
      {
        source_id: "agent_0",
        target_id: "agent_2",
        measured_distance_m: 2,
        sigma_m: 0.1,
        true_distance_m: 2
      },
      {
        source_id: "agent_2",
        target_id: "agent_3",
        measured_distance_m: 1,
        sigma_m: 0.1,
        true_distance_m: 1
      }
    ];

    const selection = selectLiveUwbLinks({
      positions: squarePositions,
      measurements: chainMeasurements,
      options: { ...baseOptions, maxLinksPerAgent: 2, maxRangeM: 3, addRangeM: 3 }
    });

    expect(selection.selectedLinks.map(stableUwbEndpointKey)).toContain("agent_2::agent_3");
  });

  it("prefers triangle closure after basic coverage exists", () => {
    const selection = selectLiveUwbLinks({
      positions,
      measurements,
      options: baseOptions
    });

    expect(selection.selectedLinks.map(stableUwbEndpointKey)).toEqual([
      "agent_0::agent_1",
      "agent_0::agent_2",
      "agent_1::agent_2"
    ]);
    expect(selection.diagnostics.triangleCount).toBe(1);
  });

  it("does not rate-limit the initial graph fill when no previous links exist", () => {
    const selection = selectLiveUwbLinks({
      positions,
      measurements,
      options: { ...baseOptions, maxGraphChangesPerFrame: 1 }
    });

    expect(selection.selectedLinks.map(stableUwbEndpointKey)).toEqual([
      "agent_0::agent_1",
      "agent_0::agent_2",
      "agent_1::agent_2"
    ]);
    expect(selection.diagnostics.addedLinks).toBe(3);
  });

  it("deduplicates reversed or repeated candidate measurements by endpoint pair", () => {
    const selection = selectLiveUwbLinks({
      positions,
      measurements: [
        {
          source_id: "agent_0",
          target_id: "agent_1",
          measured_distance_m: 1,
          sigma_m: 0.1,
          true_distance_m: 1
        },
        {
          source_id: "agent_1",
          target_id: "agent_0",
          measured_distance_m: 1,
          sigma_m: 0.1,
          true_distance_m: 1
        },
        {
          source_id: "agent_0",
          target_id: "agent_1",
          measured_distance_m: 1,
          sigma_m: 0.1,
          true_distance_m: 1
        }
      ],
      previousSelectedLinks: [{
        sourceId: "agent_1",
        targetId: "agent_0",
        measuredDistanceM: 1,
        sigmaM: 0.1,
        selectionReason: "new"
      }],
      options: { ...baseOptions, maxLinksPerAgent: 7 }
    });

    expect(selection.candidates.map((candidate) => candidate.key)).toEqual([
      "agent_0::agent_1"
    ]);
    expect(selection.selectedLinks.map(stableUwbEndpointKey)).toEqual([
      "agent_0::agent_1"
    ]);
  });

  it("rejects a link that closes a degenerate collinear triangle", () => {
    const collinearPositions = new Map<string, Position3D>([
      ["agent_0", [0, 0, 0]],
      ["agent_1", [2, 0, 0]],
      ["agent_2", [4, 0, 0]]
    ]);
    const collinearMeasurements: UwbMeasurement[] = [
      {
        source_id: "agent_0",
        target_id: "agent_1",
        measured_distance_m: 2,
        sigma_m: 0.1,
        true_distance_m: 2
      },
      {
        source_id: "agent_1",
        target_id: "agent_2",
        measured_distance_m: 2,
        sigma_m: 0.1,
        true_distance_m: 2
      },
      {
        source_id: "agent_0",
        target_id: "agent_2",
        measured_distance_m: 4,
        sigma_m: 0.1,
        true_distance_m: 4
      }
    ];

    const selection = selectLiveUwbLinks({
      positions: collinearPositions,
      measurements: collinearMeasurements,
      options: {
        ...baseOptions,
        maxLinksPerAgent: 3,
        maxRangeM: 5,
        addRangeM: 5,
        dropRangeM: 5.5
      }
    });

    expect(selection.selectedLinks.map(stableUwbEndpointKey)).toEqual([
      "agent_0::agent_1",
      "agent_1::agent_2"
    ]);
  });

  it("drops a retained link that is collinear with currently selected links", () => {
    const collinearPositions = new Map<string, Position3D>([
      ["agent_0", [0, 0, 0]],
      ["agent_1", [2, 0, 0]],
      ["agent_2", [4, 0, 0]]
    ]);
    const collinearMeasurements: UwbMeasurement[] = [
      {
        source_id: "agent_0",
        target_id: "agent_1",
        measured_distance_m: 2,
        sigma_m: 0.1,
        true_distance_m: 2
      },
      {
        source_id: "agent_1",
        target_id: "agent_2",
        measured_distance_m: 2,
        sigma_m: 0.1,
        true_distance_m: 2
      },
      {
        source_id: "agent_0",
        target_id: "agent_2",
        measured_distance_m: 4,
        sigma_m: 0.1,
        true_distance_m: 4
      }
    ];
    const previouslySelectedLinks = collinearMeasurements.map((measurement) => ({
      sourceId: measurement.source_id,
      targetId: measurement.target_id,
      measuredDistanceM: measurement.measured_distance_m,
      sigmaM: measurement.sigma_m,
      selectionReason: "new" as const
    }));

    const selection = selectLiveUwbLinks({
      positions: collinearPositions,
      measurements: collinearMeasurements,
      previousSelectedLinks: previouslySelectedLinks,
      options: {
        ...baseOptions,
        maxLinksPerAgent: 3,
        maxRangeM: 5,
        addRangeM: 5,
        dropRangeM: 5.5
      }
    });

    expect(selection.selectedLinks.map(stableUwbEndpointKey)).toEqual([
      "agent_0::agent_1",
      "agent_1::agent_2"
    ]);
    expect(selection.diagnostics.droppedLinks).toBe(1);
  });

  it("rejects a nested collinear link sharing an endpoint even without a closed triangle", () => {
    const collinearPositions = new Map<string, Position3D>([
      ["agent_0", [0, 0, 0]],
      ["agent_1", [2, 0, 0]],
      ["agent_2", [4, 0, 0]]
    ]);
    const nestedMeasurements: UwbMeasurement[] = [
      {
        source_id: "agent_0",
        target_id: "agent_1",
        measured_distance_m: 2,
        sigma_m: 0.1,
        true_distance_m: 2
      },
      {
        source_id: "agent_0",
        target_id: "agent_2",
        measured_distance_m: 4,
        sigma_m: 0.1,
        true_distance_m: 4
      }
    ];

    const selection = selectLiveUwbLinks({
      positions: collinearPositions,
      measurements: nestedMeasurements,
      previousSelectedLinks: [{
        sourceId: "agent_0",
        targetId: "agent_1",
        measuredDistanceM: 2,
        sigmaM: 0.1,
        selectionReason: "new"
      }],
      options: {
        ...baseOptions,
        maxLinksPerAgent: 3,
        maxRangeM: 5,
        addRangeM: 5,
        dropRangeM: 5.5
      }
    });

    expect(selection.selectedLinks.map(stableUwbEndpointKey)).toEqual([
      "agent_0::agent_1"
    ]);
  });

  it("retains existing links until drop range and delays new links until add range", () => {
    const boundaryPositions = new Map<string, Position3D>([
      ["agent_0", [0, 0, 0]],
      ["agent_1", [2.05, 0, 0]],
      ["agent_2", [1.95, 0, 0]]
    ]);
    const boundaryMeasurements: UwbMeasurement[] = [
      {
        source_id: "agent_0",
        target_id: "agent_1",
        measured_distance_m: 2.05,
        sigma_m: 0.1,
        true_distance_m: 2.05
      },
      {
        source_id: "agent_0",
        target_id: "agent_2",
        measured_distance_m: 1.95,
        sigma_m: 0.1,
        true_distance_m: 1.95
      }
    ];

    const selection = selectLiveUwbLinks({
      positions: boundaryPositions,
      measurements: boundaryMeasurements,
      previousSelectedLinks: [{
        sourceId: "agent_0",
        targetId: "agent_1",
        measuredDistanceM: 2,
        sigmaM: 0.1,
        selectionReason: "new"
      }],
      options: {
        ...baseOptions,
        maxLinksPerAgent: 2,
        maxRangeM: 2,
        addRangeM: 1.9,
        dropRangeM: 2.1
      }
    });

    expect(selection.selectedLinks.map(stableUwbEndpointKey)).toEqual(["agent_0::agent_1"]);
    expect(selection.diagnostics.addedLinks).toBe(0);
  });

  it("drops previous links past drop range and limits additions per frame", () => {
    const movingPositions = new Map<string, Position3D>([
      ["agent_0", [0, 0, 0]],
      ["agent_1", [2.3, 0, 0]],
      ["agent_2", [1, 0, 0]],
      ["agent_3", [0, 0, 1]]
    ]);
    const movingMeasurements: UwbMeasurement[] = [
      {
        source_id: "agent_0",
        target_id: "agent_1",
        measured_distance_m: 2.3,
        sigma_m: 0.1,
        true_distance_m: 2.3
      },
      {
        source_id: "agent_0",
        target_id: "agent_2",
        measured_distance_m: 1,
        sigma_m: 0.1,
        true_distance_m: 1
      },
      {
        source_id: "agent_0",
        target_id: "agent_3",
        measured_distance_m: 1,
        sigma_m: 0.1,
        true_distance_m: 1
      }
    ];

    const selection = selectLiveUwbLinks({
      positions: movingPositions,
      measurements: movingMeasurements,
      previousSelectedLinks: [{
        sourceId: "agent_0",
        targetId: "agent_1",
        measuredDistanceM: 2,
        sigmaM: 0.1,
        selectionReason: "new"
      }],
      options: {
        ...baseOptions,
        maxLinksPerAgent: 2,
        maxRangeM: 2,
        addRangeM: 2,
        dropRangeM: 2.1,
        maxGraphChangesPerFrame: 1
      }
    });

    expect(selection.selectedLinks.map(stableUwbEndpointKey)).toHaveLength(1);
    expect(selection.selectedLinks.map(stableUwbEndpointKey)).not.toContain("agent_0::agent_1");
    expect(selection.diagnostics.droppedLinks).toBe(1);
    expect(selection.diagnostics.addedLinks).toBe(1);
  });
});
