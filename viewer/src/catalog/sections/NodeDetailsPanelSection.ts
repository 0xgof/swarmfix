import type { NodeInspectorModel } from "../../ui/NodeDetailsPanel";
import { createCatalogSection } from "../CatalogSection";

const FIXTURE: NodeInspectorModel = {
  agentId: "agent_0",
  truthPosition: [1, 2, 0],
  gnssPosition: [1.08, 2.04, 0],
  currentEstimate: [1.04, 2.02, 0],
  fusedEstimate: [1.02, 2.01, 0],
  correctedEstimate: [1.01, 2, 0],
  referenceMeasurement: [1, 2, 0],
  gnssResidualNorm: 0.09,
  connectedUwbLinks: [{ sourceId: "agent_0", targetId: "agent_1" }]
};

export function createNodeDetailsPanelSection(): HTMLElement {
  const section = createCatalogSection({
    title: "Node Details Panel",
    subtitle: "Agent position inspector"
  });
  section.stage.innerHTML = `
    <div class="catalog-panel-demo">
      <h3>${FIXTURE.agentId}</h3>
      <p>truth ${FIXTURE.truthPosition?.join(", ")}</p>
      <p>GNSS ${FIXTURE.gnssPosition?.join(", ")}</p>
      <p>fused ${FIXTURE.fusedEstimate?.join(", ")}</p>
      <p>corrected ${FIXTURE.correctedEstimate?.join(", ")}</p>
      <p>UWB links ${FIXTURE.connectedUwbLinks.length}</p>
    </div>
  `;
  return section.element;
}
