import { describe, expect, it, vi } from "vitest";

import { createCatalogObserver } from "./catalogObserver";
import { createCatalogSection } from "./CatalogSection";

describe("catalog scaffold", () => {
  it("creates a section root and stage with visibility callbacks", () => {
    const onVisible = vi.fn();
    const onHidden = vi.fn();
    const section = createCatalogSection({
      title: "Markers",
      subtitle: "Marker examples",
      onVisible,
      onHidden
    });

    section.element.classList.add("visible");
    section.element.classList.remove("visible");

    expect(section.element.className).toContain("catalog-section");
    expect(section.stage.className).toContain("section-stage");
    expect(section.stage.parentElement).toBe(section.element);
    expect(section.element.textContent).toContain("Markers");
    expect(section.element.textContent).toContain("Marker examples");
    expect(onVisible).toHaveBeenCalledTimes(1);
    expect(onHidden).toHaveBeenCalledTimes(1);
  });

  it("observes sections with a shared IntersectionObserver", () => {
    const observed: Element[] = [];
    let callback: IntersectionObserverCallback | null = null;
    const disconnect = vi.fn();
    vi.stubGlobal("IntersectionObserver", class MockIntersectionObserver {
      constructor(observerCallback: IntersectionObserverCallback) {
        callback = observerCallback;
      }

      observe(element: Element): void {
        observed.push(element);
      }

      disconnect = disconnect;
    });
    const onVisible = vi.fn();
    const onHidden = vi.fn();
    const element = document.createElement("section");

    const observer = createCatalogObserver();
    observer.observe(element, onVisible, onHidden);
    callback!([{
      target: element,
      intersectionRatio: 0.4
    } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    callback!([{
      target: element,
      intersectionRatio: 0.1
    } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    observer.disconnect();

    expect(observed).toEqual([element]);
    expect(element.classList.contains("visible")).toBe(false);
    expect(onVisible).toHaveBeenCalledTimes(1);
    expect(onHidden).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
