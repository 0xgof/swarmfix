import { describe, expect, it } from "vitest";

import { NewtonPage } from "./NewtonPage";
import {
  NEWTON_DIAGNOSTICS_STORAGE_KEY,
  type NewtonSharedState
} from "./newtonSharedState";
import type { LiveSolveRequest } from "../live/liveSolveTypes";

describe("NewtonPage", () => {
  it("enables main-viewer diagnostics publishing while mounted", () => {
    localStorage.removeItem(NEWTON_DIAGNOSTICS_STORAGE_KEY);
    const root = document.createElement("div");
    const page = new NewtonPage(root);

    page.mount();

    expect(localStorage.getItem(NEWTON_DIAGNOSTICS_STORAGE_KEY)).toBe("1");

    page.destroy();
    expect(localStorage.getItem(NEWTON_DIAGNOSTICS_STORAGE_KEY)).toBeNull();
  });

  it("restores a previous diagnostics setting when destroyed", () => {
    localStorage.setItem(NEWTON_DIAGNOSTICS_STORAGE_KEY, "custom");
    const root = document.createElement("div");
    const page = new NewtonPage(root);

    page.mount();
    page.destroy();

    expect(localStorage.getItem(NEWTON_DIAGNOSTICS_STORAGE_KEY)).toBe("custom");
  });

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

  it("extends UWB selection highlights to the normal matrix and vectors", () => {
    const root = document.createElement("div");
    const page = new NewtonPage(root);
    page.mount();

    const link = root.querySelector<HTMLElement>("[data-newton-selection='uwb:agent_0::agent_1']");
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(root.querySelectorAll(".newton-normal-cell.highlighted").length).toBeGreaterThan(0);
    expect(root.querySelectorAll(".newton-rhs-entry.highlighted").length).toBeGreaterThan(0);
    expect(root.querySelectorAll(".newton-delta-entry.highlighted").length).toBeGreaterThan(0);
  });

  it("selects formation elements on pointer down", () => {
    const root = document.createElement("div");
    const page = new NewtonPage(root);
    page.mount();

    const drone = root.querySelector<HTMLElement>("[data-newton-selection='drone:agent_1']");
    drone?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(root.textContent).toContain("Drone agent_1");

    const gnss = root.querySelector<HTMLElement>("[data-newton-selection='gnss:agent_0']");
    gnss?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(root.textContent).toContain("GNSS agent_0");

    const link = root.querySelector<HTMLElement>("[data-newton-selection='uwb:agent_0::agent_1']");
    link?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(root.textContent).toContain("UWB agent_0 -> agent_1");
  });

  it("renders larger invisible hit targets for formation picking", () => {
    const root = document.createElement("div");
    const page = new NewtonPage(root);
    page.mount();

    expect(root.querySelectorAll(".newton-formation-hit-target").length).toBeGreaterThanOrEqual(5);
  });

  it("bounds dense matrix DOM cells for larger linked requests", () => {
    const root = document.createElement("div");
    const request: LiveSolveRequest = {
      schema_version: "0.1.0",
      dimension: 3,
      agents: Array.from({ length: 20 }, (_, index) => ({
        agent_id: `agent_${index}`,
        position_m: [index, 0, 0]
      })),
      gnss: Array.from({ length: 20 }, (_, index) => ({
        agent_id: `agent_${index}`,
        position_m: [index + 0.5, 0, 0],
        sigma_m: 1
      })),
      uwb: [],
      selected_uwb_links: [],
      estimation: { max_iterations: 40, robust_loss: "linear" }
    };
    const state: NewtonSharedState = {
      schemaVersion: "0.1.0",
      timestampMs: 5,
      missionAction: null,
      liveSolveRequest: request,
      liveSolveResponse: null,
      selectedUwbLinks: [],
      solverBackend: "large-test"
    };
    const page = new NewtonPage(root, { subscribe: (listener) => {
      listener(state);
      return () => undefined;
    } });

    page.mount();

    expect(root.querySelectorAll(".newton-matrix-cell").length).toBeLessThanOrEqual(1800);
    expect(root.textContent).toContain("showing first");
  });

  it("keeps UWB endpoint columns highlighted when the UWB residual row is outside the visible window", () => {
    const root = document.createElement("div");
    const request: LiveSolveRequest = {
      schema_version: "0.1.0",
      dimension: 3,
      agents: Array.from({ length: 10 }, (_, index) => ({
        agent_id: `agent_${index}`,
        position_m: [index, 0, 0]
      })),
      gnss: Array.from({ length: 10 }, (_, index) => ({
        agent_id: `agent_${index}`,
        position_m: [index + 0.5, 0, 0],
        sigma_m: 1
      })),
      uwb: [{
        source_id: "agent_0",
        target_id: "agent_1",
        distance_m: 2,
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
      solverBackend: "large-test"
    };
    const page = new NewtonPage(root, { subscribe: (listener) => {
      listener(state);
      return () => undefined;
    } });

    page.mount();
    const link = root.querySelector<HTMLElement>("[data-newton-selection='uwb:agent_0::agent_1']");
    link?.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(root.textContent).toContain("UWB agent_0 -> agent_1");
    expect(root.querySelectorAll(".newton-j-cell.highlighted").length).toBeGreaterThan(0);
  });
});
