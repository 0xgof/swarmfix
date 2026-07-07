import { visualTokens } from "../../style/visualTokens";
import { createCatalogSection } from "../CatalogSection";

export function createVisualTokensSection(): HTMLElement {
  const section = createCatalogSection({
    title: "Visual Tokens",
    subtitle: "Colors, opacities, and sizes from visualTokens.ts"
  });
  const grid = document.createElement("div");
  grid.className = "token-grid";

  for (const [name, color] of Object.entries(visualTokens.color)) {
    const swatch = document.createElement("div");
    const square = document.createElement("span");
    square.style.display = "inline-block";
    square.style.width = "24px";
    square.style.height = "24px";
    square.style.backgroundColor = color;
    swatch.append(square, ` color.${name} ${color}`);
    grid.append(swatch);
  }

  for (const [name, opacity] of Object.entries(visualTokens.opacity)) {
    const sample = document.createElement("div");
    sample.textContent = `opacity.${name} ${opacity}`;
    sample.style.opacity = String(opacity);
    grid.append(sample);
  }

  for (const [name, size] of Object.entries(visualTokens.markerSize)) {
    const marker = document.createElement("div");
    marker.textContent = `markerSize.${name} ${size}`;
    grid.append(marker);
  }

  section.stage.append(grid);
  return section.element;
}
