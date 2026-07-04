import {
  normalizeMissionActionState,
  type FormationMode,
  type MissionActionState,
  type MotionMode
} from "../simulation/missionActions";
import {
  fallbackMissionActionCatalog,
  type MissionActionCatalog
} from "../live/missionActionCatalogClient";

export interface MissionActionControlsProps {
  value: MissionActionState;
  catalog?: MissionActionCatalog;
  onChange: (nextValue: MissionActionState) => void;
}

function optionElement(value: string,
                       label: string): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function numericInput(name: string,
                      value: number,
                      step: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "number";
  input.name = name;
  input.min = "0";
  input.step = step;
  input.value = String(value);
  return input;
}

function row(labelText: string,
             input: HTMLElement): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "mission-action-row";
  const labelSpan = document.createElement("span");
  labelSpan.textContent = labelText;
  label.append(labelSpan, input);
  return label;
}

export function createMissionActionControls(props: MissionActionControlsProps): HTMLElement {
  let currentValue = normalizeMissionActionState(props.value);
  const catalog = props.catalog ?? fallbackMissionActionCatalog;
  const container = document.createElement("div");
  container.className = "mission-action-controls";

  const formationSelect = document.createElement("select");
  formationSelect.name = "formation";
  for (const option of catalog.formations) {
    formationSelect.append(optionElement(option.id, option.label));
  }
  formationSelect.value = currentValue.formation;

  const motionSelect = document.createElement("select");
  motionSelect.name = "motion";
  for (const option of catalog.motions) {
    motionSelect.append(optionElement(option.id, option.label));
  }
  motionSelect.value = currentValue.motion;

  const speedInput = numericInput("speedMps", currentValue.speedMps, "0.1");
  const amplitudeInput = numericInput(
    "randomWalkAmplitudeM",
    currentValue.randomWalkAmplitudeM,
    "0.05"
  );
  const readout = document.createElement("p");
  readout.className = "mission-action-readout";

  const renderReadout = (): void => {
    readout.textContent = `${currentValue.formation} / ${currentValue.motion}`;
  };

  const emit = (update: Partial<MissionActionState>): void => {
    currentValue = normalizeMissionActionState({ ...currentValue, ...update });
    speedInput.value = String(currentValue.speedMps);
    amplitudeInput.value = String(currentValue.randomWalkAmplitudeM);
    renderReadout();
    props.onChange(currentValue);
  };

  formationSelect.addEventListener("change", () => {
    emit({ formation: formationSelect.value as FormationMode });
  });
  motionSelect.addEventListener("change", () => {
    emit({ motion: motionSelect.value as MotionMode });
  });
  speedInput.addEventListener("input", () => {
    emit({ speedMps: Number(speedInput.value) || 0 });
  });
  amplitudeInput.addEventListener("input", () => {
    emit({ randomWalkAmplitudeM: Number(amplitudeInput.value) || 0 });
  });

  renderReadout();
  container.append(
    row("formation", formationSelect),
    row("motion", motionSelect),
    row("speed", speedInput),
    row("random", amplitudeInput),
    readout
  );
  return container;
}
