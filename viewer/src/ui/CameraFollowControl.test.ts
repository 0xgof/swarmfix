import { describe, expect, it, vi } from "vitest";

import { createCameraFollowControl } from "./CameraFollowControl";

describe("CameraFollowControl", () => {
  it("emits barycenter follow toggle changes without ViewerState", () => {
    const onChange = vi.fn();
    const element = createCameraFollowControl({
      followsBarycenter: false,
      onChange
    });
    const input = element.querySelector<HTMLInputElement>(
      'input[name="cameraFollowsSwarmBarycenter"]'
    );

    expect(input).not.toBeNull();
    expect(input!.checked).toBe(false);

    input!.checked = true;
    input!.dispatchEvent(new Event("change"));

    expect(onChange).toHaveBeenCalledWith(true);
    expect(element.textContent).toContain("Follow swarm barycenter");
  });
});
