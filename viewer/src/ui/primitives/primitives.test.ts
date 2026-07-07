import { describe, expect, it, vi } from "vitest";

import {
  createButton,
  createCheckbox,
  createCheckboxGroup,
  createInfoPanel,
  createInfoRow,
  createSlider,
  createStatusBadge
} from "./index";

describe("UI primitives", () => {
  it("creates an updateable button with variants and click handling", () => {
    const onClick = vi.fn();
    const button = createButton({ label: "Run", variant: "primary", onClick });

    button.element.click();
    button.update({ label: "Retry", variant: "ghost", onClick });

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button.element.textContent).toBe("Retry");
    expect(button.element.className).toContain("ghost");
  });

  it("creates an updateable numeric slider", () => {
    const onChange = vi.fn();
    const slider = createSlider({
      label: "Links",
      min: 0,
      max: 6,
      step: 1,
      value: 3,
      onChange
    });
    const input = slider.element.querySelector("input") as HTMLInputElement;

    input.value = "5";
    input.dispatchEvent(new Event("input"));
    slider.update({ label: "Links", min: 0, max: 8, step: 1, value: 4, onChange });

    expect(onChange).toHaveBeenCalledWith(5);
    expect(input.max).toBe("8");
    expect(slider.element.textContent).toContain("4");
  });

  it("creates updateable checkbox controls", () => {
    const onChange = vi.fn();
    const checkbox = createCheckbox({ label: "Truth", checked: true, onChange });
    const input = checkbox.element.querySelector("input") as HTMLInputElement;

    input.checked = false;
    input.dispatchEvent(new Event("change"));
    checkbox.update({ label: "Truth", checked: false, onChange });

    expect(onChange).toHaveBeenCalledWith(false);
    expect(input.checked).toBe(false);
  });

  it("creates an updateable checkbox group", () => {
    const onChange = vi.fn();
    const group = createCheckboxGroup({
      items: [
        { key: "truth", label: "truth", checked: true },
        { key: "uwb", label: "UWB", checked: false }
      ],
      onChange
    });
    const inputs = group.element.querySelectorAll("input");

    inputs[1].checked = true;
    inputs[1].dispatchEvent(new Event("change"));
    group.update({
      items: [{ key: "truth", label: "truth", checked: false }],
      onChange
    });

    expect(onChange).toHaveBeenCalledWith("uwb", true);
    expect(group.element.querySelectorAll("input")).toHaveLength(1);
  });

  it("creates updateable info rows, panels, and status badges", () => {
    const row = createInfoRow({ label: "cost", value: "1.2" });
    const panel = createInfoPanel({ title: "Metrics", rows: [{ label: "GNSS", value: "2" }] });
    const badge = createStatusBadge({ label: "connected", tone: "ok" });

    row.update({ label: "cost", value: "1.4" });
    panel.update({ title: "Metrics", rows: [{ label: "UWB", value: "3" }] });
    badge.update({ label: "offline", tone: "error" });

    expect(row.element.textContent).toContain("1.4");
    expect(panel.element.textContent).toContain("UWB");
    expect(panel.element.textContent).not.toContain("GNSS");
    expect(badge.element.className).toContain("error");
  });
});
