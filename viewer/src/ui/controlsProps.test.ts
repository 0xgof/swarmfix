import { describe, expect, it, vi } from "vitest";

import { createIterationSlider } from "./IterationSlider";
import { createLayerControls } from "./LayerControls";
import {
  createLinkCountControl,
  updateLinkCountDiagnostics
} from "./LinkCountControl";
import { createMissionActionControls } from "./MissionActionControls";
import { fallbackMissionActionCatalog } from "../live/missionActionCatalogClient";
import { defaultMissionActionState } from "../simulation/missionActions";

describe("props-based viewer controls", () => {
  it("IterationSlider emits the selected iteration without ViewerState", () => {
    const onChange = vi.fn();
    const element = createIterationSlider({
      min: 0,
      max: 10,
      value: 2,
      label: "exported trace iteration",
      reason: "Inspects exported trace state.",
      onChange
    });
    const input = element.querySelector("input") as HTMLInputElement;

    input.value = "7";
    input.dispatchEvent(new Event("input"));

    expect(input.min).toBe("0");
    expect(input.max).toBe("10");
    expect(element.textContent).toContain("exported trace iteration");
    expect(element.textContent).toContain("Inspects exported trace state.");
    expect(onChange).toHaveBeenCalledWith(7);
  });

  it("LayerControls emits key and visibility without ViewerState", () => {
    const onChange = vi.fn();
    const element = createLayerControls({
      layers: [
        { key: "truth", label: "truth", visible: true },
        {
          key: "references",
          label: "reference",
          visible: false,
          disabled: true,
          reason: "No reference measurements."
        }
      ],
      onChange
    });
    const inputs = element.querySelectorAll("input");

    inputs[1].checked = true;
    inputs[1].dispatchEvent(new Event("change"));

    expect(inputs).toHaveLength(2);
    expect(inputs[1].disabled).toBe(true);
    expect(element.textContent).toContain("No reference measurements.");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("LinkCountControl emits the selected link count without ViewerState", () => {
    const onChange = vi.fn();
    const element = createLinkCountControl({
      max: 6,
      value: 3,
      diagnostics: {
        candidateLinkCount: 6,
        selectedLinkCount: 3,
        adaptiveSelectionEnabled: true
      },
      onChange
    });
    const input = element.querySelector("input") as HTMLInputElement;

    input.value = "5";
    input.dispatchEvent(new Event("input"));

    expect(input.max).toBe("6");
    expect(element.textContent).toContain("5");
    expect(element.textContent).toContain("3/6 selected");
    expect(element.textContent).toContain("adaptive");
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it("LinkCountControl diagnostics follow later selection updates", () => {
    const element = createLinkCountControl({
      max: 6,
      value: 3,
      diagnostics: {
        candidateLinkCount: 6,
        selectedLinkCount: 3,
        adaptiveSelectionEnabled: true
      },
      onChange: vi.fn()
    });

    updateLinkCountDiagnostics(element, {
      candidateLinkCount: 6,
      selectedLinkCount: 1,
      adaptiveSelectionEnabled: true
    });

    expect(element.textContent).toContain("1/6 selected");
    expect(element.textContent).not.toContain("3/6 selected");
  });

  it("MissionActionControls emits typed action updates without ViewerState", () => {
    const onChange = vi.fn();
    const element = createMissionActionControls({
      value: defaultMissionActionState(),
      onChange
    });
    const formation = element.querySelector<HTMLSelectElement>('[name="formation"]')!;
    const motion = element.querySelector<HTMLSelectElement>('[name="motion"]')!;
    const speed = element.querySelector<HTMLInputElement>('[name="speedMps"]')!;
    const amplitude = element.querySelector<HTMLInputElement>(
      '[name="randomWalkAmplitudeM"]'
    )!;

    formation.value = "wedge";
    formation.dispatchEvent(new Event("change"));
    motion.value = "forward";
    motion.dispatchEvent(new Event("change"));
    speed.value = "3.5";
    speed.dispatchEvent(new Event("input"));
    amplitude.value = "-4";
    amplitude.dispatchEvent(new Event("input"));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ formation: "wedge" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ motion: "forward" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ speedMps: 3.5 }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ randomWalkAmplitudeM: 0 }));
  });

  it("MissionActionControls renders formation and motion options from catalog data", () => {
    const element = createMissionActionControls({
      value: defaultMissionActionState(),
      catalog: {
        ...fallbackMissionActionCatalog,
        formations: [{
          id: "ring",
          label: "backend ring",
          description: "backend ring option",
          parameters: [],
          geometryTraits: ["planar"],
          solverGeometryRisk: "low"
        }],
        motions: [{
          id: "static",
          label: "backend static",
          description: "backend static option",
          parameters: [],
          geometryTraits: [],
          solverGeometryRisk: "low"
        }]
      },
      onChange: vi.fn()
    });
    const formationOptions = Array.from(
      element.querySelectorAll<HTMLOptionElement>('[name="formation"] option')
    );
    const motionOptions = Array.from(
      element.querySelectorAll<HTMLOptionElement>('[name="motion"] option')
    );

    expect(formationOptions.map((option) => option.value)).toEqual(["ring"]);
    expect(formationOptions.map((option) => option.textContent)).toEqual(["backend ring"]);
    expect(motionOptions.map((option) => option.value)).toEqual(["static"]);
    expect(motionOptions.map((option) => option.textContent)).toEqual(["backend static"]);
  });

  it("MissionActionControls emits bounded drone-count changes without changing action state", () => {
    const onChange = vi.fn();
    const onDroneCountChange = vi.fn();
    const element = createMissionActionControls({
      value: defaultMissionActionState(),
      droneCount: 3,
      onChange,
      onDroneCountChange
    });
    const droneCount = element.querySelector<HTMLSelectElement>('[name="missionDroneCount"]')!;

    droneCount.value = "8";
    droneCount.dispatchEvent(new Event("change"));

    expect(onDroneCountChange).toHaveBeenCalledWith(8);
    expect(onChange).not.toHaveBeenCalled();
    expect(element.textContent).toContain("8 drones");
  });
});
