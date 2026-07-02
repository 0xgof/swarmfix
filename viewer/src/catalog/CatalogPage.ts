import "./catalog.css";

import { createCatalogObserver, type CatalogObserver } from "./catalogObserver";
import { catalogSectionFactories, type CatalogSectionFactory } from "./catalogSections";

export class CatalogPage {
  private root: HTMLElement;
  private sectionFactories: CatalogSectionFactory[];
  private observer: CatalogObserver;
  private navDots: HTMLButtonElement[];

  constructor(root: HTMLElement,
              sectionFactories: CatalogSectionFactory[] = catalogSectionFactories,
              observer: CatalogObserver = createCatalogObserver()) {
    this.root = root;
    this.sectionFactories = sectionFactories;
    this.observer = observer;
    this.navDots = [];
  }

  mount(): void {
    this.observer.disconnect();
    this.root.innerHTML = "";
    this.navDots = [];

    const scrollRoot = document.createElement("main");
    scrollRoot.className = "catalog-scroll-root";
    const nav = this.createNav();
    const sections = this.sectionFactories.map((factory, index) => (
      this.createSectionSafely(factory, index)
    ));
    for (const [index, section] of sections.entries()) {
      scrollRoot.append(section);
    }
    this.root.append(nav, scrollRoot);
    for (const [index, section] of sections.entries()) {
      this.observer.observe(section, () => this.markSectionVisible(index));
    }
    if (sections[0]) {
      sections[0].classList.add("visible");
      this.markSectionVisible(0);
    }
  }

  markSectionVisibleForTest(index: number): void {
    this.markSectionVisible(index);
  }

  private createNav(): HTMLElement {
    const nav = document.createElement("nav");
    nav.className = "catalog-nav";
    const link = document.createElement("a");
    link.href = "/";
    link.textContent = "<- Viewer";
    const title = document.createElement("strong");
    title.textContent = "UI Catalog";
    const dots = document.createElement("div");
    dots.className = "catalog-nav-dots";

    for (let index = 0; index < this.sectionFactories.length; index += 1) {
      const dot = document.createElement("button");
      dot.className = "catalog-nav-dot";
      dot.type = "button";
      dots.append(dot);
      this.navDots.push(dot);
    }
    nav.append(link, title, dots);
    return nav;
  }

  private createSectionSafely(factory: CatalogSectionFactory,
                              index: number): HTMLElement {
    try {
      const section = factory();
      return section;
    } catch (error) {
      const section = document.createElement("section");
      section.className = "catalog-section visible";
      section.dataset.catalogTitle = `Section ${index + 1} failed`;
      const message = error instanceof Error ? error.message : String(error);
      section.innerHTML = `
        <h2>Catalog section unavailable</h2>
        <div class="section-stage">
          <p>${message}</p>
        </div>
      `;
      return section;
    }
  }

  private markSectionVisible(index: number): void {
    for (const [dotIndex, dot] of this.navDots.entries()) {
      dot.classList.toggle("active", dotIndex === index);
    }
  }
}
