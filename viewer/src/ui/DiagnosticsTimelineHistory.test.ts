import { describe, expect, it } from "vitest";

import {
  DiagnosticHistory,
  displayErrorBreakdown,
  gnssTruthErrorBreakdown,
  type ViewerDiagnosticSample
} from "./DiagnosticsTimelineHistory";

function sample(timestampMs: number): ViewerDiagnosticSample {
  const diagnosticSample: ViewerDiagnosticSample = {
    timestampMs,
    costTotal: timestampMs,
    costGnss: timestampMs / 2,
    costUwb: timestampMs / 4,
    errorRmseM: timestampMs / 1000,
    errorMeanM: timestampMs / 1200,
    errorMaxM: timestampMs / 800,
    gnssErrorRmseM: timestampMs / 900,
    gnssErrorMeanM: timestampMs / 1100,
    gnssErrorMaxM: timestampMs / 700,
    solveErrorRmseM: timestampMs / 1500,
    solveErrorMeanM: timestampMs / 1600,
    solveErrorMaxM: timestampMs / 1400,
    solveGnssErrorRmseM: timestampMs / 1300,
    solveGnssErrorMeanM: timestampMs / 1350,
    solveGnssErrorMaxM: timestampMs / 1250,
    solveImprovementRmseM: timestampMs / 5000,
    fusedWorseThanGnss: false,
    responseAgeMs: 42,
    missionDroneCount: 10,
    formationMode: "grid",
    motionMode: "random_walk",
    speedMps: 1,
    randomWalkAmplitudeM: 0.24,
    selectedUwbLinks: 22
  };
  return diagnosticSample;
}

describe("DiagnosticsTimelineHistory", () => {
  it("computes aggregate display error from current truth and displayed estimates", () => {
    const truth = new Map<string, number[]>([
      ["agent_0", [0, 0, 0]],
      ["agent_1", [3, 0, 0]]
    ]);
    const estimates = [
      { agent_id: "agent_0", position_m: [0, 0, 0] },
      { agent_id: "agent_1", position_m: [0, 0, 0] }
    ];

    const error = displayErrorBreakdown(truth, estimates);

    expect(error).toEqual({
      rmseM: Math.sqrt(9 / 2),
      meanErrorM: 1.5,
      maxErrorM: 3
    });
  });

  it("returns null instead of NaN when truth or estimates are missing", () => {
    expect(displayErrorBreakdown(new Map(), [])).toBeNull();
    expect(displayErrorBreakdown(new Map([["agent_0", [0, 0, 0]]]), [])).toBeNull();
  });

  it("computes GNSS baseline error from raw GNSS positions and current truth", () => {
    const truth = new Map<string, number[]>([
      ["agent_0", [0, 0, 0]],
      ["agent_1", [3, 0, 0]]
    ]);
    const gnssPositions = new Map<string, number[]>([
      ["agent_0", [0, 5, 0]],
      ["agent_1", [3, 5, 0]]
    ]);

    const error = gnssTruthErrorBreakdown(truth, gnssPositions);

    expect(error).toEqual({
      rmseM: 5,
      meanErrorM: 5,
      maxErrorM: 5
    });
  });

  it("keeps a rolling 60 second window as new samples arrive", () => {
    const history = new DiagnosticHistory({ windowMs: 60000, maxSamples: 300 });

    history.append(sample(0));
    history.append(sample(30000));
    history.append(sample(61000));

    expect(history.samples().map((entry) => entry.timestampMs)).toEqual([30000, 61000]);
  });

  it("stores display and solver snapshot quality independently", () => {
    const history = new DiagnosticHistory({ windowMs: 60000, maxSamples: 300 });

    history.append({
      ...sample(1000),
      errorRmseM: 4,
      gnssErrorRmseM: 2,
      solveErrorRmseM: 0.4,
      solveGnssErrorRmseM: 1.2,
      responseAgeMs: 125
    });

    expect(history.samples()[0]).toMatchObject({
      errorRmseM: 4,
      gnssErrorRmseM: 2,
      solveErrorRmseM: 0.4,
      solveGnssErrorRmseM: 1.2,
      responseAgeMs: 125
    });
  });

  it("caps retained samples and cleans up idempotently", () => {
    const history = new DiagnosticHistory({ windowMs: 60000, maxSamples: 3 });

    history.append(sample(1000));
    history.append(sample(2000));
    history.append(sample(3000));
    history.append(sample(4000));
    expect(history.samples().map((entry) => entry.timestampMs)).toEqual([2000, 3000, 4000]);

    history.cleanup();
    history.cleanup();
    expect(history.samples()).toEqual([]);

    history.append(sample(5000));
    expect(history.samples()).toHaveLength(1);
  });

  it("clears retained samples for a fresh diagnostic stream", () => {
    const history = new DiagnosticHistory({ windowMs: 60000, maxSamples: 300 });

    history.append(sample(1000));
    history.append(sample(2000));
    history.clear();

    expect(history.count()).toBe(0);
    expect(history.samples()).toEqual([]);
  });
});
