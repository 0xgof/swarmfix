export interface LayerControlItem {
  key: string;
  label: string;
  visible: boolean;
  group?: string;
  disabled?: boolean;
  reason?: string;
}

export interface LayerControlsProps {
  layers: LayerControlItem[];
  onChange: (key: string, visible: boolean) => void;
}

export function createLayerControls(props: LayerControlsProps): HTMLElement {
  const container = document.createElement("div");
  container.className = "layer-controls";
  let currentGroup: string | null = null;

  for (const layer of props.layers) {
    if (layer.group && layer.group !== currentGroup) {
      currentGroup = layer.group;
      const heading = document.createElement("div");
      heading.className = "layer-control-group";
      heading.textContent = currentGroup;
      container.append(heading);
    }
    const label = document.createElement("label");
    if (layer.disabled) {
      label.classList.add("disabled");
    }
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = layer.visible;
    checkbox.disabled = layer.disabled ?? false;
    checkbox.addEventListener("change", () => {
      if (checkbox.disabled) {
        return;
      }
      props.onChange(layer.key, checkbox.checked);
    });
    const labelText = document.createElement("span");
    labelText.textContent = layer.label;
    label.append(checkbox, labelText);
    if (layer.reason) {
      const reason = document.createElement("span");
      reason.className = "control-reason";
      reason.textContent = layer.reason;
      label.append(reason);
      label.title = layer.reason;
    }
    container.append(label);
  }

  return container;
}
