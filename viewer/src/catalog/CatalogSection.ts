export interface CatalogSectionOptions {
  title: string;
  subtitle?: string;
  onVisible?: () => void;
  onHidden?: () => void;
}

export interface CatalogSection {
  element: HTMLElement;
  stage: HTMLElement;
}

export function createCatalogSection(options: CatalogSectionOptions): CatalogSection {
  const element = document.createElement("section");
  element.className = "catalog-section";
  element.dataset.catalogTitle = options.title;
  let isVisible = false;

  const heading = document.createElement("h2");
  heading.textContent = options.title;
  element.append(heading);

  if (options.subtitle) {
    const subtitle = document.createElement("p");
    subtitle.textContent = options.subtitle;
    element.append(subtitle);
  }

  const stage = document.createElement("div");
  stage.className = "section-stage";
  element.append(stage);

  const emitVisibility = (): void => {
    const nextVisible = element.classList.contains("visible");
    if (nextVisible === isVisible) {
      return;
    }
    isVisible = nextVisible;
    if (nextVisible) {
      options.onVisible?.();
      return;
    }
    options.onHidden?.();
  };
  const originalAdd = element.classList.add.bind(element.classList);
  const originalRemove = element.classList.remove.bind(element.classList);
  element.classList.add = (...tokens: string[]): void => {
    originalAdd(...tokens);
    if (tokens.includes("visible")) {
      emitVisibility();
    }
  };
  element.classList.remove = (...tokens: string[]): void => {
    originalRemove(...tokens);
    if (tokens.includes("visible")) {
      emitVisibility();
    }
  };
  const observer = new MutationObserver(emitVisibility);
  observer.observe(element, { attributes: true, attributeFilter: ["class"] });

  return { element, stage };
}
