import { describe, expect, it, vi } from "vitest";

import { DiagnosticsTimelinePanel } from "./DiagnosticsTimelinePanel";
import type { ViewerDiagnosticSample } from "./DiagnosticsTimelineHistory";

function sample(timestampMs: number,
                costTotal: number,
                errorRmseM: number): ViewerDiagnosticSample {
  const diagnosticSample: ViewerDiagnosticSample = {
    timestampMs,
    costTotal,
    costGnss: costTotal * 0.4,
    costUwb: costTotal * 0.6,
    errorRmseM,
    errorMeanM: errorRmseM * 0.7,
    errorMaxM: errorRmseM * 1.5,
    gnssErrorRmseM: errorRmseM * 2,
    gnssErrorMeanM: errorRmseM * 1.8,
    gnssErrorMaxM: errorRmseM * 2.5,
    missionDroneCount: 10,
    formationMode: "grid",
    motionMode: "random_walk",
    speedMps: 1,
    randomWalkAmplitudeM: 0.24,
    selectedUwbLinks: 22
  };
  return diagnosticSample;
}

describe("DiagnosticsTimelinePanel", () => {
  it("renders cost and error SVG paths with current labels", () => {
    const panel = new DiagnosticsTimelinePanel();

    panel.update([
      sample(0, 10, 0.2),
      sample(60000, 30, 0.6)
    ]);

    expect(panel.element.className).toContain("diagnostics-timeline-panel");
    expect(panel.element.textContent).toContain("cost vs time");
    expect(panel.element.textContent).toContain("error vs time");
    expect(panel.element.textContent).toContain("last 60 s");
    expect(panel.element.textContent).toContain("30.000");
    expect(panel.element.textContent).toContain("0.600 m");
    expect(panel.element.textContent).toContain("GNSS 1.200 m");
    expect(panel.element.querySelectorAll("path.diagnostics-timeline-path")).toHaveLength(3);
    expect(panel.element.querySelectorAll("path.diagnostics-timeline-path-secondary")).toHaveLength(1);
    expect(panel.element.innerHTML).not.toContain("NaN");
  });

  it("smooths multi-sample timelines with cubic Bezier paths", () => {
    const panel = new DiagnosticsTimelinePanel();

    panel.update([
      sample(0, 10, 0.2),
      sample(30000, 20, 0.5),
      sample(60000, 12, 0.3)
    ]);

    const path = panel.element.querySelector("path.diagnostics-timeline-path");
    expect(path?.getAttribute("d")).toContain("C");
    expect(path?.getAttribute("d")).not.toContain("NaN");
  });

  it("renders an empty state without NaN", () => {
    const panel = new DiagnosticsTimelinePanel();

    panel.update([]);

    expect(panel.element.textContent).toContain("waiting for live solver data");
    expect(panel.element.innerHTML).not.toContain("NaN");
  });

  it("calls the reset callback from the reset button", () => {
    const onReset = vi.fn();
    const panel = new DiagnosticsTimelinePanel({ onReset });

    panel.update([sample(0, 10, 0.2)]);
    panel.element.querySelector<HTMLButtonElement>(".diagnostics-timeline-reset")?.click();

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("removes the reset listener when disposed", () => {
    const onReset = vi.fn();
    const panel = new DiagnosticsTimelinePanel({ onReset });

    panel.update([sample(0, 10, 0.2)]);
    const resetButton = panel.element.querySelector<HTMLButtonElement>(
      ".diagnostics-timeline-reset"
    );
    panel.dispose();
    resetButton?.click();

    expect(onReset).not.toHaveBeenCalled();
  });

  it("disposes owned DOM state idempotently", () => {
    const panel = new DiagnosticsTimelinePanel();
    const host = document.createElement("div");
    host.append(panel.element);

    panel.update([sample(0, 10, 0.2)]);
    panel.dispose();
    panel.dispose();

    expect(host.children).toHaveLength(0);
    expect(panel.element.children).toHaveLength(0);
  });
});
