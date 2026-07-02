import { beforeEach, describe, expect, it, vi } from "vitest";

import { Box3, Camera, Scene, Vector3 } from "three";

import { createConnectionStatusSection } from "./ConnectionStatusSection";
import { createCostBreakdownPanelSection } from "./CostBreakdownPanelSection";
import { createEdgeDetailsPanelSection } from "./EdgeDetailsPanelSection";
import { createGnssCloudSection } from "./GnssCloudSection";
import { createIterationSliderSection } from "./IterationSliderSection";
import { createLayerControlsSection } from "./LayerControlsSection";
import { createLinkCountControlSection } from "./LinkCountControlSection";
import { createMarkersSection } from "./MarkersSection";
import { createMeasurementInspectorSection } from "./MeasurementInspectorSection";
import { createNodeDetailsPanelSection } from "./NodeDetailsPanelSection";
import { createUwbLinkSection } from "./UwbLinkSection";
import { createVisualTokensSection } from "./VisualTokensSection";

const rendererTracker = vi.hoisted(() => ({
  instances: [] as Array<{ render: ReturnType<typeof import("vitest").vi.fn> }>
}));

const orbitTracker = vi.hoisted(() => ({
  instances: [] as Array<{
    camera: unknown;
    domElement: unknown;
    enableDamping: boolean;
    autoRotate: boolean;
  }>
}));

vi.mock("three/examples/jsm/controls/OrbitControls.js", () => ({
  OrbitControls: class MockOrbitControls {
    enableDamping = false;
    autoRotate = false;
    autoRotateSpeed = 0;
    minDistance = 0;
    maxDistance = Infinity;
    update = vi.fn();

    constructor(public camera: unknown,
                public domElement: unknown) {
      orbitTracker.instances.push(this);
    }
  }
}));

vi.mock("three", async () => {
  const actual = await vi.importActual<typeof import("three")>("three");
  class MockWebGLRenderer {
    domElement = document.createElement("canvas");
    setSize = vi.fn();
    setPixelRatio = vi.fn();
    render = vi.fn();

    constructor() {
      rendererTracker.instances.push(this);
    }
  }
  return { ...actual, WebGLRenderer: MockWebGLRenderer };
});

describe("catalog sections", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("renders static visual token and inspector sections", () => {
    expect(createVisualTokensSection().textContent).toContain("Visual Tokens");
    expect(createNodeDetailsPanelSection().textContent).toContain("agent_0");
    expect(createEdgeDetailsPanelSection().textContent).toContain("agent_0 to agent_1");
    expect(createCostBreakdownPanelSection().textContent).toContain("12.500");
    expect(createMeasurementInspectorSection().textContent).toContain("0.320");
  });

  it("renders mini Three.js section canvases inside section stages", () => {
    for (const factory of [
      createMarkersSection,
      createUwbLinkSection,
      createGnssCloudSection
    ]) {
      const section = factory();
      const canvas = section.querySelector("canvas");
      expect(canvas).not.toBeNull();
      expect(canvas!.parentElement!.className).toContain("section-stage");
    }
  });

  it("draws each mini Three.js scene through a camera on creation", () => {
    for (const factory of [
      createMarkersSection,
      createUwbLinkSection,
      createGnssCloudSection
    ]) {
      rendererTracker.instances.length = 0;
      factory();

      const renderer = rendererTracker.instances[0];
      expect(renderer).toBeDefined();
      expect(renderer.render).toHaveBeenCalled();
      const [renderedScene, renderedCamera] = renderer.render.mock.calls[0];
      expect(renderedScene).toBeInstanceOf(Scene);
      expect(renderedCamera).toBeInstanceOf(Camera);
    }
  });

  it("keeps rotating showcase content centred on the rotation axis", () => {
    for (const factory of [createMarkersSection, createUwbLinkSection]) {
      rendererTracker.instances.length = 0;
      factory();

      const [renderedScene] = rendererTracker.instances[0].render.mock.calls[0];
      const contentBounds = new Box3().setFromObject(renderedScene);
      const contentCenter = contentBounds.getCenter(new Vector3());
      expect(Math.abs(contentCenter.x)).toBeLessThan(0.3);
      expect(Math.abs(contentCenter.z)).toBeLessThan(0.3);
    }
  });

  it("attaches drag-rotate and zoom orbit controls to each mini stage canvas", () => {
    for (const factory of [
      createMarkersSection,
      createUwbLinkSection,
      createGnssCloudSection
    ]) {
      orbitTracker.instances.length = 0;
      const section = factory();

      const controls = orbitTracker.instances[0];
      expect(controls).toBeDefined();
      expect(controls.camera).toBeInstanceOf(Camera);
      expect(controls.domElement).toBe(section.querySelector("canvas"));
    }
  });

  it("marker size handle rescales the marker row", () => {
    rendererTracker.instances.length = 0;
    const section = createMarkersSection();
    const [renderedScene] = rendererTracker.instances[0].render.mock.calls[0];
    const sizeBefore = new Box3().setFromObject(renderedScene).getSize(new Vector3());

    const handleInput = section.querySelector<HTMLInputElement>(".prop-handle input");
    expect(handleInput).not.toBeNull();
    handleInput!.value = "2.5";
    handleInput!.dispatchEvent(new Event("input"));

    const sizeAfter = new Box3().setFromObject(renderedScene).getSize(new Vector3());
    expect(sizeAfter.y).toBeGreaterThan(sizeBefore.y);
    expect(section.textContent).toContain("2.5");
  });

  it("sigma handle scales the UWB cord vibration amplitude", () => {
    rendererTracker.instances.length = 0;
    const section = createUwbLinkSection();
    const [renderedScene] = rendererTracker.instances[0].render.mock.calls[0];
    const handleInput = section.querySelector<HTMLInputElement>(".prop-handle input");
    expect(handleInput).not.toBeNull();

    handleInput!.value = "0";
    handleInput!.dispatchEvent(new Event("input"));
    const slimSize = new Box3().setFromObject(renderedScene).getSize(new Vector3());

    handleInput!.value = "2";
    handleInput!.dispatchEvent(new Event("input"));
    const wideSize = new Box3().setFromObject(renderedScene).getSize(new Vector3());

    expect(wideSize.z).toBeGreaterThan(slimSize.z);
  });

  it("sigma handle resizes the GNSS uncertainty cloud", () => {
    rendererTracker.instances.length = 0;
    const section = createGnssCloudSection();
    const [renderedScene] = rendererTracker.instances[0].render.mock.calls[0];
    const handleInput = section.querySelector<HTMLInputElement>(".prop-handle input");
    expect(handleInput).not.toBeNull();

    handleInput!.value = "0.2";
    handleInput!.dispatchEvent(new Event("input"));
    const smallSize = new Box3().setFromObject(renderedScene).getSize(new Vector3());

    handleInput!.value = "2";
    handleInput!.dispatchEvent(new Event("input"));
    const largeSize = new Box3().setFromObject(renderedScene).getSize(new Vector3());

    expect(largeSize.x).toBeGreaterThan(smallSize.x);
  });

  it("keeps drawing frames while a mini Three.js section is visible", () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    try {
      rendererTracker.instances.length = 0;
      const section = createUwbLinkSection();
      const renderer = rendererTracker.instances[0];
      const rendersBeforeVisible = renderer.render.mock.calls.length;

      section.classList.add("visible");
      frameCallbacks.shift()!(16);

      expect(renderer.render.mock.calls.length).toBeGreaterThan(rendersBeforeVisible);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("renders interactive control sections with live state labels", () => {
    const layerSection = createLayerControlsSection();
    const iterationSection = createIterationSliderSection();
    const linkSection = createLinkCountControlSection();

    const layerInput = layerSection.querySelector("input") as HTMLInputElement;
    layerInput.checked = false;
    layerInput.dispatchEvent(new Event("change"));
    const iterationInput = iterationSection.querySelector("input") as HTMLInputElement;
    iterationInput.value = "9";
    iterationInput.dispatchEvent(new Event("input"));
    const linkInput = linkSection.querySelector("input") as HTMLInputElement;
    linkInput.value = "5";
    linkInput.dispatchEvent(new Event("input"));

    expect(layerSection.textContent).toContain("Visible:");
    expect(iterationSection.textContent).toContain("Iteration: 9");
    expect(linkSection.textContent).toContain("Links per drone: 5");
  });

  it("cycles connection status and clears the interval when hidden", () => {
    vi.useFakeTimers();
    const section = createConnectionStatusSection();

    section.classList.add("visible");
    expect(section.textContent).toContain("connected");
    vi.advanceTimersByTime(2000);
    expect(section.textContent).toContain("checking");
    vi.advanceTimersByTime(2000);
    expect(section.textContent).toContain("disconnected");
    section.classList.remove("visible");
    vi.advanceTimersByTime(2000);
    expect(section.textContent).toContain("connected");
  });
});
