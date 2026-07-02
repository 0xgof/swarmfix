import { describe, expect, it } from "vitest";

import source from "./createScene.ts?raw";

describe("createSwarmScene live solve contract", () => {
  it("does not call the browser-side approximate fusion solver", () => {
    expect(source).not.toContain("solveLiveFusion");
  });
});
