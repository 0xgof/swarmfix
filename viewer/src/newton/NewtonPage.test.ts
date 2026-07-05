import { describe, expect, it } from "vitest";

import { NewtonPage } from "./NewtonPage";
import type { NewtonSharedState } from "./newtonSharedState";
import type { LiveSolveRequest } from "../live/liveSolveTypes";

describe("NewtonPage", () => {
  it("renders the diagnostic shell and normal-system equation", () => {
    const root = document.createElement("div");
    const page = new NewtonPage(root);

    page.mount();

    expect(root.querySelector(".newton-page")).not.toBeNull();
    expect(root.textContent).toContain("Newton Solver");
    expect(root.textContent).toContain("Static Formation");
    expect(root.textContent).toContain("J^T J");
    expect(root.textContent).toContain("delta_x");
    expect(root.textContent).toContain("-J^T r");
    expect(root.querySelectorAll(".newton-matrix-cell").length).toBeGreaterThan(0);
  });

  it("updates the page from linked viewer shared state", () => {
    const root = document.createElement("div");
    const request: LiveSolveRequest = {
      schema_version: "0.1.0",
      dimension: 3,
      agents: [
        { agent_id: "agent_0", position_m: [0, 0, 0] },
        { agent_id: "agent_1", position_m: [3, 0, 0] }
      ],
      gnss: [
        { agent_id: "agent_0", position_m: [0, 0, 0], sigma_m: 1 },
        { agent_id: "agent_1", position_m: [4, 0, 0], sigma_m: 1 }
      ],
      uwb: [{
        source_id: "agent_0",
        target_id: "agent_1",
        distance_m: 5,
        sigma_m: 1,
        true_distance_m: null
      }],
      selected_uwb_links: [{ source_id: "agent_0", target_id: "agent_1" }],
      estimation: { max_iterations: 40, robust_loss: "linear" }
    };
    const state: NewtonSharedState = {
      schemaVersion: "0.1.0",
      timestampMs: 5,
      missionAction: null,
      liveSolveRequest: request,
      liveSolveResponse: null,
      selectedUwbLinks: request.selected_uwb_links,
      solverBackend: "linked-test"
    };
    const page = new NewtonPage(root, { subscribe: (listener) => {
      listener(state);
      return () => undefined;
    } });

    page.mount();

    expect(root.textContent).toContain("linked-test");
    expect(root.textContent).toContain("linked viewer state");
  });

  it("selects a UWB link and highlights the related J cells", () => {
    const root = document.createElement("div");
    const page = new NewtonPage(root);
    page.mount();

    const link = root.querySelector<HTMLElement>("[data-newton-selection='uwb:agent_0::agent_1']");
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(root.textContent).toContain("UWB agent_0 -> agent_1");
    expect(root.querySelector(".newton-formation-link.selected")).not.toBeNull();
    expect(root.querySelectorAll(".newton-j-cell.highlighted").length).toBeGreaterThan(0);
  });
});
