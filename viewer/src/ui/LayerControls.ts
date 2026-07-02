export interface LayerControlItem {
  key: string;
  label: string;
  visible: boolean;
}

export interface LayerControlsProps {
  layers: LayerControlItem[];
  onChange: (key: string, visible: boolean) => void;
}

export function createLayerControls(props: LayerControlsProps): HTMLElement {
  const container = document.createElement("div");
  container.className = "layer-controls";

  for (const layer of props.layers) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = layer.visible;
    checkbox.addEventListener("change", () => {
      props.onChange(layer.key, checkbox.checked);
    });
    label.append(checkbox, layer.label);
    container.append(label);
  }

  return container;
}
