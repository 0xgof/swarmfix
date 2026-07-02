import { createIterationSlider } from "../../ui/IterationSlider";
import { createCatalogSection } from "../CatalogSection";

export function createIterationSliderSection(): HTMLElement {
  let iteration = 0;
  const section = createCatalogSection({
    title: "Iteration Slider",
    subtitle: "Scrub through solver trace iterations"
  });
  const readout = document.createElement("p");
  const renderReadout = (): void => {
    readout.textContent = `Iteration: ${iteration}`;
  };
  const slider = createIterationSlider({
    min: 0,
    max: 50,
    value: iteration,
    onChange: (nextIteration) => {
      iteration = nextIteration;
      renderReadout();
    }
  });
  renderReadout();
  section.stage.append(slider, readout);
  return section.element;
}
