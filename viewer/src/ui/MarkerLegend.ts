export interface MarkerLegendProps {
  selectedUwbLinks: number;
  totalUwbLinkCap: number;
}

export function createMarkerLegend(props: MarkerLegendProps): HTMLElement {
  const legend = document.createElement("section");
  legend.className = "marker-legend";
  legend.setAttribute("aria-label", "Marker legend");

  const items = [
    { key: "truth", label: "Ground truth" },
    { key: "gnss", label: "GNSS measurement" },
    { key: "fused", label: "Fused estimate" },
    { key: "uwb", label: "UWB links" },
    { key: "position-error", label: "Position error" }
  ];

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "marker-legend-item";

    const glyph = document.createElement("span");
    glyph.className = `marker-legend-glyph marker-legend-glyph-${item.key}`;
    glyph.setAttribute("aria-hidden", "true");

    if (item.key === "truth") {
      glyph.append(crossArm("horizontal"), crossArm("vertical"));
    }
    if (item.key === "uwb" || item.key === "position-error") {
      glyph.append(linkLine());
    }

    const label = document.createElement("span");
    label.className = "marker-legend-label";
    label.textContent = item.label;
    row.append(glyph, label);
    if (item.key === "uwb") {
      const counter = document.createElement("span");
      counter.className = "marker-legend-link-counter";
      row.append(counter);
    }
    legend.append(row);
  }

  updateMarkerLegend(legend, props);
  return legend;
}

export function updateMarkerLegend(legend: HTMLElement,
                                   props: MarkerLegendProps): void {
  const counter = legend.querySelector<HTMLElement>(".marker-legend-link-counter");
  if (!counter) {
    return;
  }

  const selectedLinks = Math.max(0, Math.floor(props.selectedUwbLinks));
  const linkCap = Math.max(0, Math.floor(props.totalUwbLinkCap));
  counter.textContent = `${selectedLinks}/${linkCap} cap`;
}

function crossArm(direction: "horizontal" | "vertical"): HTMLElement {
  const arm = document.createElement("span");
  arm.className = `marker-legend-cross-arm marker-legend-cross-arm-${direction}`;
  return arm;
}

function linkLine(): HTMLElement {
  const line = document.createElement("span");
  line.className = "marker-legend-link-line";
  return line;
}
