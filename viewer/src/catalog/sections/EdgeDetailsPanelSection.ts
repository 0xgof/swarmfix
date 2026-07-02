import type { EdgeInspectorModel } from "../../ui/EdgeDetailsPanel";
import { createCatalogSection } from "../CatalogSection";

const FIXTURE: EdgeInspectorModel = {
  sourceId: "agent_0",
  targetId: "agent_1",
  measuredDistanceM: 3.14,
  sigmaM: 0.1,
  trueDistanceM: 3.12,
  currentDistanceM: 3.2,
  residualM: 0.06,
  weightedSq: 0.36
};

export function createEdgeDetailsPanelSection(): HTMLElement {
  const section = createCatalogSection({
    title: "Edge Details Panel",
    subtitle: "UWB link inspector"
  });
  section.stage.innerHTML = `
    <div class="catalog-panel-demo">
      <h3>${FIXTURE.sourceId} to ${FIXTURE.targetId}</h3>
      <p>measured ${FIXTURE.measuredDistanceM.toFixed(3)}</p>
      <p>residual ${FIXTURE.residualM?.toFixed(3)}</p>
      <p>weighted ${FIXTURE.weightedSq?.toFixed(3)}</p>
    </div>
  `;
  return section.element;
}
