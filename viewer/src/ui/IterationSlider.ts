export interface IterationSliderProps {
  min: number;
  max: number;
  value: number;
  label?: string;
  disabled?: boolean;
  reason?: string;
  onChange: (iteration: number) => void;
}

export function createIterationSlider(props: IterationSliderProps): HTMLElement {
  const label = document.createElement("label");
  label.className = "iteration-slider";
  const labelText = document.createElement("span");
  labelText.className = "control-label";
  labelText.textContent = props.label ?? "iteration";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(props.min);
  slider.max = String(props.max);
  slider.value = String(props.value);
  slider.disabled = props.disabled ?? false;
  slider.addEventListener("input", () => {
    if (slider.disabled) {
      return;
    }
    props.onChange(Number(slider.value));
  });

  label.append(labelText, slider);
  if (props.reason) {
    const reason = document.createElement("span");
    reason.className = "control-reason";
    reason.textContent = props.reason;
    label.title = props.reason;
    label.append(reason);
  }
  return label;
}
