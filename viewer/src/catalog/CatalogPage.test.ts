import { describe, expect, it, vi } from "vitest";

import { CatalogPage } from "./CatalogPage";

function sectionFactory(label: string): () => HTMLElement {
  return () => {
    const section = document.createElement("section");
    section.className = "catalog-section";
    section.dataset.catalogTitle = label;
    section.textContent = label;
    return section;
  };
}

describe("CatalogPage", () => {
  it("mounts a scroll root, nav, viewer link, and one dot per section", () => {
    const root = document.createElement("div");
    const page = new CatalogPage(root, [sectionFactory("A"), sectionFactory("B")]);

    page.mount();
    page.mount();

    expect(root.querySelectorAll(".catalog-scroll-root")).toHaveLength(1);
    expect(root.querySelectorAll(".catalog-nav")).toHaveLength(1);
    expect(root.querySelector<HTMLAnchorElement>(".catalog-nav a")!.href).toContain("/");
    expect(root.textContent).toContain("UI Catalog");
    expect(root.querySelectorAll(".catalog-nav-dot")).toHaveLength(2);
    expect(root.querySelectorAll(".catalog-section")).toHaveLength(2);
  });

  it("activates the nav dot for the visible section", () => {
    const root = document.createElement("div");
    const page = new CatalogPage(root, [sectionFactory("A"), sectionFactory("B")]);

    page.mount();
    page.markSectionVisibleForTest(1);

    const dots = root.querySelectorAll(".catalog-nav-dot");
    expect(dots[0].classList.contains("active")).toBe(false);
    expect(dots[1].classList.contains("active")).toBe(true);
  });

  it("accepts an injected observer after all sections are appended", () => {
    const root = document.createElement("div");
    const observe = vi.fn(() => {
      expect(root.querySelectorAll(".catalog-section")).toHaveLength(1);
    });
    const page = new CatalogPage(root, [sectionFactory("A")], {
      observe,
      disconnect: vi.fn()
    });

    page.mount();

    expect(root.querySelectorAll(".catalog-section")).toHaveLength(1);
    expect(observe).toHaveBeenCalledTimes(1);
  });

  it("keeps the catalog visible when one section factory fails", () => {
    const root = document.createElement("div");
    const failingFactory = (): HTMLElement => {
      throw new Error("WebGL unavailable");
    };
    const page = new CatalogPage(root, [
      sectionFactory("A"),
      failingFactory,
      sectionFactory("B")
    ]);

    page.mount();

    expect(root.querySelectorAll(".catalog-scroll-root")).toHaveLength(1);
    expect(root.textContent).toContain("A");
    expect(root.textContent).toContain("B");
    expect(root.textContent).toContain("WebGL unavailable");
  });
});
