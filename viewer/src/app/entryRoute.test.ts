import { describe, expect, it } from "vitest";

import { routeForPathname } from "./entryRoute";

describe("entry route selection", () => {
  it("routes /ui_catalog to the catalog and / to the viewer", () => {
    expect(routeForPathname("/ui_catalog")).toBe("catalog");
    expect(routeForPathname("/ui_catalog/markers")).toBe("catalog");
    expect(routeForPathname("/")).toBe("viewer");
  });
});
