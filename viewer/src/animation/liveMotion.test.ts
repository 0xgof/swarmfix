import { describe, expect, it } from "vitest";

import {
  animatedGaussianScale,
  animatedSwarmPosition,
  liftPositionTo3D,
  selectUwbLinks,
  selectUwbLinksByMaxDegree
} from "./liveMotion";
import type { UwbMeasurement } from "../data/sceneTypes";

const uwbLinks: UwbMeasurement[] = [
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
    measured_distance_m: 3,
    sigma_m: 0.1,
    true_distance_m: 3
  },
  {
    source_id: "agent_1",
    target_id: "agent_2",
    measured_distance_m: 4,
    sigma_m: 0.1,
    true_distance_m: 4
  }
];

describe("live 3D motion helpers", () => {
  it("lifts exported 2D positions into a real 3D scene", () => {
    expect(liftPositionTo3D([1, 2])).toEqual([1, 0, 2]);
    expect(liftPositionTo3D([1, 2, 3])).toEqual([1, 3, 2]);
  });

  it("moves drones deterministically within a bounded jitter radius", () => {
    const firstPosition = animatedSwarmPosition("agent_0", [5, 0, 5], 10, 0.4);
    const repeatedPosition = animatedSwarmPosition("agent_0", [5, 0, 5], 10, 0.4);
    const dx = firstPosition[0] - 5;
    const dy = firstPosition[1] - 0;
    const dz = firstPosition[2] - 5;
    const distance = Math.hypot(dx, dy, dz);

    expect(firstPosition).toEqual(repeatedPosition);
    expect(distance).toBeLessThanOrEqual(0.7);
  });

  it("selects measured UWB links according to the configured link count", () => {
    expect(selectUwbLinks(uwbLinks, 0)).toHaveLength(0);
    expect(selectUwbLinks(uwbLinks, 2).map((link) => link.target_id)).toEqual([
      "agent_1",
      "agent_2"
    ]);
    expect(selectUwbLinks(uwbLinks, 99)).toHaveLength(3);
  });

  it("selects a deterministic UWB graph capped by max links per drone", () => {
    const selectedLinks = selectUwbLinksByMaxDegree(uwbLinks, 1);
    const degreeByAgent = new Map<string, number>();
    for (const link of selectedLinks) {
      degreeByAgent.set(link.source_id, (degreeByAgent.get(link.source_id) ?? 0) + 1);
      degreeByAgent.set(link.target_id, (degreeByAgent.get(link.target_id) ?? 0) + 1);
    }

    expect(selectedLinks).toEqual([uwbLinks[0]]);
    expect(Math.max(...degreeByAgent.values())).toBeLessThanOrEqual(1);
  });

  it("selects all available links when the per-drone cap allows the full graph", () => {
    expect(selectUwbLinksByMaxDegree(uwbLinks, 2)).toEqual(uwbLinks);
  });

  it("animates Gaussian scale over time without changing the base sigma", () => {
    const firstScale = animatedGaussianScale("agent_0", 2, 0);
    const laterScale = animatedGaussianScale("agent_0", 2, 1.5);

    expect(firstScale).not.toBe(laterScale);
    expect(firstScale).toBeGreaterThan(1.6);
    expect(laterScale).toBeLessThan(2.5);
  });
});
