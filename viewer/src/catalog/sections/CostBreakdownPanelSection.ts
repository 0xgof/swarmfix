import type { TraceCost } from "../../data/sceneTypes";
import { createCatalogSection } from "../CatalogSection";

const FIXTURE: TraceCost = {
  total: 12.5,
  gnss: 3.25,
  uwb: 8.75,
  reference: 0.5
};

export function createCostBreakdownPanelSection(): HTMLElement {
  const section = createCatalogSection({
    title: "Cost Breakdown Panel",
    subtitle: "Solver cost contributions by measurement type"
  });
  section.stage.innerHTML = `
    <div class="catalog-panel-demo">
      <p>total ${FIXTURE.total.toFixed(3)}</p>
      <p>GNSS ${FIXTURE.gnss.toFixed(3)}</p>
      <p>UWB ${FIXTURE.uwb.toFixed(3)}</p>
      <p>reference ${FIXTURE.reference.toFixed(3)}</p>
    </div>
  `;
  return section.element;
}
