import type { Camera } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface PropHandleOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onInput: (value: number) => void;
}

export function createStageOrbitControls(camera: Camera,
                                         domElement: HTMLElement): OrbitControls {
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.5;
  controls.minDistance = 1;
  controls.maxDistance = 20;
  return controls;
}

export function createPropHandle(options: PropHandleOptions): HTMLElement {
  const handle = document.createElement("label");
  handle.className = "prop-handle";

  const caption = document.createElement("span");
  caption.textContent = options.label;
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(options.min);
  slider.max = String(options.max);
  slider.step = String(options.step);
  slider.value = String(options.value);
  const valueLabel = document.createElement("span");
  valueLabel.className = "prop-handle-value";
  valueLabel.textContent = String(options.value);

  slider.addEventListener("input", () => {
    const sliderValue = Number(slider.value);
    valueLabel.textContent = String(sliderValue);
    options.onInput(sliderValue);
  });

  handle.append(caption, slider, valueLabel);
  return handle;
}
