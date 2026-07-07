import { describe, expect, it } from "vitest";

import { routeForPathname } from "./entryRoute";

describe("entry route", () => {
  it("routes /newton to the Newton diagnostic page", () => {
    expect(routeForPathname("/newton")).toBe("newton");
    expect(routeForPathname("/newton/live")).toBe("newton");
  });

  it("keeps existing viewer and catalog routes stable", () => {
    expect(routeForPathname("/ui_catalog")).toBe("catalog");
    expect(routeForPathname("/")).toBe("viewer");
    expect(routeForPathname("/anything_else")).toBe("viewer");
  });
});
