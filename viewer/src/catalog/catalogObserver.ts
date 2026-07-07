export interface CatalogObserver {
  observe: (element: HTMLElement, onVisible?: () => void, onHidden?: () => void) => void;
  disconnect: () => void;
}

export function createCatalogObserver(): CatalogObserver {
  const callbacks = new Map<Element, {
    onVisible?: () => void;
    onHidden?: () => void;
  }>();
  if (typeof IntersectionObserver === "undefined") {
    const fallbackObserver = {
      observe(element: HTMLElement,
              onVisible?: () => void,
              onHidden?: () => void): void {
        callbacks.set(element, { onVisible, onHidden });
        element.classList.add("visible");
        onVisible?.();
      },
      disconnect(): void {
        callbacks.clear();
      }
    };
    return fallbackObserver;
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const handlers = callbacks.get(entry.target);
      if (entry.intersectionRatio >= 0.3) {
        entry.target.classList.add("visible");
        handlers?.onVisible?.();
      } else {
        entry.target.classList.remove("visible");
        handlers?.onHidden?.();
      }
    }
  }, { threshold: 0.3 });

  const catalogObserver = {
    observe(element: HTMLElement,
            onVisible?: () => void,
            onHidden?: () => void): void {
      callbacks.set(element, { onVisible, onHidden });
      observer.observe(element);
    },
    disconnect(): void {
      callbacks.clear();
      observer.disconnect();
    }
  };
  return catalogObserver;
}
