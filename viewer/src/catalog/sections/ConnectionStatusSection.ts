import {
  buildConnectionStatusModel,
  type ConnectionStatusInput
} from "../../ui/ConnectionStatusPanel";
import { createCatalogSection } from "../CatalogSection";

const STATES: ConnectionStatusInput[] = [
  {
    status: "connected",
    endpointUrl: "http://localhost:8765",
    lastError: null
  },
  {
    status: "checking",
    endpointUrl: "http://localhost:8765",
    lastError: null
  },
  {
    status: "disconnected",
    endpointUrl: "http://localhost:8765",
    lastError: "Connection refused"
  }
];

export function createConnectionStatusSection(): HTMLElement {
  let stateIndex = 0;
  let interval: number | null = null;
  const section = createCatalogSection({
    title: "Connection Status Panel",
    subtitle: "Live solver connection states",
    onVisible: () => {
      stateIndex = 0;
      render();
      interval = window.setInterval(nextState, 2000);
    },
    onHidden: () => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
      stateIndex = 0;
      render();
    }
  });
  const panel = document.createElement("div");
  const indicator = document.createElement("p");

  function nextState(): void {
    stateIndex = (stateIndex + 1) % STATES.length;
    render();
  }

  function render(): void {
    const input = STATES[stateIndex];
    const model = buildConnectionStatusModel(input);
    panel.textContent = `${model.label} ${model.detail}`;
    panel.dataset.tone = model.tone;
    indicator.textContent = `state: ${input.status}`;
  }

  render();
  section.stage.append(panel, indicator);
  return section.element;
}
