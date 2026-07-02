import { describe, expect, it, vi } from "vitest";

import { createIterationSlider } from "./IterationSlider";
import { createLayerControls } from "./LayerControls";
import { createLinkCountControl } from "./LinkCountControl";

describe("props-based viewer controls", () => {
  it("IterationSlider emits the selected iteration without ViewerState", () => {
    const onChange = vi.fn();
    const element = createIterationSlider({ min: 0, max: 10, value: 2, onChange });
    const input = element.querySelector("input") as HTMLInputElement;

    input.value = "7";
    input.dispatchEvent(new Event("input"));

    expect(input.min).toBe("0");
    expect(input.max).toBe("10");
    expect(onChange).toHaveBeenCalledWith(7);
  });

  it("LayerControls emits key and visibility without ViewerState", () => {
    const onChange = vi.fn();
    const element = createLayerControls({
      layers: [
        { key: "truth", label: "truth", visible: true },
        { key: "uwb", label: "UWB", visible: false }
      ],
      onChange
    });
    const inputs = element.querySelectorAll("input");

    inputs[1].checked = true;
    inputs[1].dispatchEvent(new Event("change"));

    expect(inputs).toHaveLength(2);
    expect(onChange).toHaveBeenCalledWith("uwb", true);
  });

  it("LinkCountControl emits the selected link count without ViewerState", () => {
    const onChange = vi.fn();
    const element = createLinkCountControl({ max: 6, value: 3, onChange });
    const input = element.querySelector("input") as HTMLInputElement;

    input.value = "5";
    input.dispatchEvent(new Event("input"));

    expect(input.max).toBe("6");
    expect(element.textContent).toContain("5");
    expect(onChange).toHaveBeenCalledWith(5);
  });
});
