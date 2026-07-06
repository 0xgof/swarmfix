import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fallbackMissionActionCatalog,
  requestMissionActionCatalog
} from "./missionActionCatalogClient";

describe("mission action catalog client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the backend catalog endpoint", async () => {
    let requestedUrl = "";
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      requestedUrl = String(input);
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({
          schema_version: "0.1.0",
          formations: [{
            id: "ring",
            label: "backend ring",
            description: "backend provided ring",
            parameters: [],
            geometry_traits: ["planar"],
            solver_geometry_risk: "low"
          }],
          motions: [{
            id: "static",
            label: "backend static",
            description: "backend provided static",
            parameters: [],
            geometry_traits: [],
            solver_geometry_risk: "low"
          }]
        })
      };
    }));

    const catalog = await requestMissionActionCatalog("http://backend/mission-actions/catalog");

    expect(requestedUrl).toBe("http://backend/mission-actions/catalog");
    expect(catalog.formations.map((option) => option.id)).toEqual(["ring"]);
    expect(catalog.motions.map((option) => option.id)).toEqual(["static"]);
  });

  it("keeps an explicit fallback catalog for offline viewer startup", () => {
    expect(fallbackMissionActionCatalog.formations.map((option) => option.id)).toEqual([
      "grid",
      "line",
      "column",
      "wedge",
      "ring",
      "square_patrol",
      "random_cloud"
    ]);
    expect(fallbackMissionActionCatalog.motions.map((option) => option.id)).toEqual([
      "static",
      "random_walk",
      "forward",
      "path_follow"
    ]);
  });
});
