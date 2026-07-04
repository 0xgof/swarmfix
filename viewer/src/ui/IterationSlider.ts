export interface IterationSliderProps {
  min: number;
  max: number;
  value: number;
  onChange: (iteration: number) => void;
}

export function createIterationSlider(props: IterationSliderProps): HTMLElement {
  const label = document.createElement("label");
  label.className = "iteration-slider";
  const labelText = document.createElement("span");
  labelText.className = "control-label";
  labelText.textContent = "iteration";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(props.min);
  slider.max = String(props.max);
  slider.value = String(props.value);
  slider.addEventListener("input", () => {
    props.onChange(Number(slider.value));
  });

  label.append(labelText, slider);
  return label;
}
