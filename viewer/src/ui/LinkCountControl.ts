export interface LinkCountProps {
  max: number;
  value: number;
  onChange: (count: number) => void;
}

export function createLinkCountControl(props: LinkCountProps): HTMLElement {
  const label = document.createElement("label");
  label.className = "link-count-control";
  label.textContent = "UWB links per drone";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = String(props.max);
  slider.value = String(props.value);

  const value = document.createElement("span");
  value.textContent = String(props.value);
  slider.addEventListener("input", () => {
    value.textContent = slider.value;
    props.onChange(Number(slider.value));
  });

  label.append(slider, value);
  return label;
}
