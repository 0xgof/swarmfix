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

function maxSegmentAngleDeg(points: Array<[number, number, number]>): number {
  const segmentAngles: number[] = [];

  for (let index = 1; index < points.length - 1; index += 1) {
    const previousPoint = points[index - 1];
    const currentPoint = points[index];
    const nextPoint = points[index + 1];
    const firstSegment = [
      currentPoint[0] - previousPoint[0],
      currentPoint[1] - previousPoint[1],
      currentPoint[2] - previousPoint[2]
    ];
    const secondSegment = [
      nextPoint[0] - currentPoint[0],
      nextPoint[1] - currentPoint[1],
      nextPoint[2] - currentPoint[2]
    ];
    const segmentProduct = firstSegment[0] * secondSegment[0]
      + firstSegment[1] * secondSegment[1]
      + firstSegment[2] * secondSegment[2];
    const segmentMagnitude = Math.hypot(...firstSegment) * Math.hypot(...secondSegment);
    const safeCosine = Math.min(1, Math.max(-1, segmentProduct / segmentMagnitude));
    const angleDeg = Math.acos(safeCosine) * 180 / Math.PI;
    segmentAngles.push(angleDeg);
  }

  const maxAngleDeg = Math.max(...segmentAngles);
  return maxAngleDeg;
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
    const sourceStartIndex = Math.floor(points.length * 0.06);
    const sourceEndIndex = Math.floor(points.length * 0.2);
    const targetStartIndex = Math.floor(points.length * 0.8);
    const targetEndIndex = Math.floor(points.length * 0.94);
    const middleStartIndex = Math.floor(points.length * 0.42);
    const middleEndIndex = Math.floor(points.length * 0.58);
    const endpointOffset = Math.max(
      maxLateralOffset(points, sourceStartIndex, sourceEndIndex),
      maxLateralOffset(points, targetStartIndex, targetEndIndex)
    );
    const middleOffset = maxLateralOffset(points, middleStartIndex, middleEndIndex);

    expect(points.length).toBeGreaterThan(16);
    expect(endpointOffset).toBeGreaterThan(middleOffset * 2);
  });

  it("samples the cord densely enough to avoid hard jitter corners", () => {
    const points = buildUwbCordPoints(
      [0, 0, 0],
      [10, 0, 0],
      0.8,
      1.25,
      "agent_0",
      "agent_1"
    );

    expect(points.length).toBeGreaterThanOrEqual(64);
    expect(maxSegmentAngleDeg(points)).toBeLessThan(24);
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
