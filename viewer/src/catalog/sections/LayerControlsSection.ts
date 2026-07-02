import { createLayerControls, type LayerControlItem } from "../../ui/LayerControls";
import { createCatalogSection } from "../CatalogSection";

const DEFAULT_LAYERS: LayerControlItem[] = [
  { key: "truth", label: "truth", visible: true },
  { key: "gnss", label: "GNSS", visible: true },
  { key: "uwb", label: "UWB", visible: true }
];

export function createLayerControlsSection(): HTMLElement {
  const layers = DEFAULT_LAYERS.map((layer) => ({ ...layer }));
  const section = createCatalogSection({
    title: "Layer Controls",
    subtitle: "Toggle layer visibility"
  });
  const readout = document.createElement("p");
  const renderReadout = (): void => {
    const visibleLayers = layers.filter((layer) => layer.visible)
      .map((layer) => layer.label)
      .join(", ");
    readout.textContent = `Visible: ${visibleLayers}`;
  };
  const controls = createLayerControls({
    layers,
    onChange: (key, visible) => {
      const layer = layers.find((candidate) => candidate.key === key);
      if (layer) {
        layer.visible = visible;
      }
      renderReadout();
    }
  });
  renderReadout();
  section.stage.append(controls, readout);
  return section.element;
}
