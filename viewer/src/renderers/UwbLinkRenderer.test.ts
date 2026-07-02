import { describe, expect, it } from "vitest";
import { BufferAttribute } from "three";

import { buildUwbCordPoints, createUwbLink } from "./UwbLinkRenderer";

function maxLateralOffset(points: Array<[number, number, number]>,
                          firstIndex: number,
                          lastIndex: number): number {
  const offsets = points.slice(firstIndex, lastIndex + 1).map((point) => (
    Math.abs(point[2])
  ));
  const maxOffset = Math.max(...offsets);
  return maxOffset;
}

describe("UWB cord renderer geometry", () => {
  it("creates endpoint-local vibration with a calm middle span", () => {
    const points = buildUwbCordPoints(
      [0, 0, 0],
      [10, 0, 0],
      0.4,
      1.25,
      "agent_0",
      "agent_1"
    );
    const endpointOffset = Math.max(
      maxLateralOffset(points, 1, 5),
      maxLateralOffset(points, points.length - 6, points.length - 2)
    );
    const middleOffset = maxLateralOffset(points, 9, 15);

    expect(points.length).toBeGreaterThan(16);
    expect(endpointOffset).toBeGreaterThan(middleOffset * 2);
  });

  it("increases vibration amplitude for higher UWB sigma", () => {
    const lowSigmaPoints = buildUwbCordPoints(
      [0, 0, 0],
      [10, 0, 0],
      0.1,
      1.25,
      "agent_0",
      "agent_1"
    );
    const highSigmaPoints = buildUwbCordPoints(
      [0, 0, 0],
      [10, 0, 0],
      0.8,
      1.25,
      "agent_0",
      "agent_1"
    );

    expect(maxLateralOffset(highSigmaPoints, 1, 5)).toBeGreaterThan(
      maxLateralOffset(lowSigmaPoints, 1, 5) * 2
    );
  });

  it("is deterministic for the same link and time", () => {
    const firstPoints = buildUwbCordPoints(
      [0, 0, 0],
      [10, 0, 0],
      0.3,
      2.0,
      "agent_0",
      "agent_1"
    );
    const secondPoints = buildUwbCordPoints(
      [0, 0, 0],
      [10, 0, 0],
      0.3,
      2.0,
      "agent_0",
      "agent_1"
    );

    expect(secondPoints).toEqual(firstPoints);
  });

  it("renders exported 2D endpoint coordinates on the ground plane", () => {
    const link = createUwbLink([0, 10], [5, 10], 0.1, 0, "agent_0", "agent_1");
    const positionAttribute = link.geometry.getAttribute("position") as BufferAttribute;
    const yValues = Array.from(
      { length: positionAttribute.count },
      (_unused, index) => positionAttribute.getY(index)
    );

    expect(Math.max(...yValues)).toBeLessThan(0.2);
    expect(Math.min(...yValues)).toBeGreaterThan(-0.2);
  });
});
