import { createLinkCountControl } from "../../ui/LinkCountControl";
import { createCatalogSection } from "../CatalogSection";

export function createLinkCountControlSection(): HTMLElement {
  let linksPerDrone = 3;
  const section = createCatalogSection({
    title: "Link Count Control",
    subtitle: "Limit UWB links displayed per drone"
  });
  const readout = document.createElement("p");
  const renderReadout = (): void => {
    readout.textContent = `Links per drone: ${linksPerDrone}`;
  };
  const control = createLinkCountControl({
    max: 6,
    value: linksPerDrone,
    onChange: (count) => {
      linksPerDrone = count;
      renderReadout();
    }
  });
  renderReadout();
  section.stage.append(control, readout);
  return section.element;
}
