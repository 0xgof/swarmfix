import { defaultMissionActionState } from "../../simulation/missionActions";
import { fallbackMissionActionCatalog } from "../../live/missionActionCatalogClient";
import { createMissionActionControls } from "../../ui/MissionActionControls";
import { createCatalogSection } from "../CatalogSection";

export function createMissionActionControlsSection(): HTMLElement {
  let actionState = defaultMissionActionState();
  const section = createCatalogSection({
    title: "Mission Action Controls",
    subtitle: "Formation and motion controls for live swarm simulation"
  });
  const readout = document.createElement("p");
  const renderReadout = (): void => {
    readout.textContent = `${actionState.formation} / ${actionState.motion}`;
  };
  const controls = createMissionActionControls({
    value: actionState,
    catalog: fallbackMissionActionCatalog,
    onChange: (nextState) => {
      actionState = nextState;
      renderReadout();
    }
  });
  renderReadout();
  section.stage.append(controls, readout);
  return section.element;
}
