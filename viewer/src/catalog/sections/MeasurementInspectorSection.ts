import { createCatalogSection } from "../CatalogSection";

interface MeasurementInspectorFixture {
  agentId: string;
  gnssSigmaM: number;
  gnssPosition: number[];
  referencePosition: number[];
}

const FIXTURE: MeasurementInspectorFixture = {
  agentId: "agent_0",
  gnssSigmaM: 0.32,
  gnssPosition: [1.08, 2.04, 0],
  referencePosition: [1, 2, 0]
};

export function createMeasurementInspectorSection(): HTMLElement {
  const section = createCatalogSection({
    title: "Measurement Inspector",
    subtitle: "GNSS sigma and reference position for a selected agent"
  });
  section.stage.innerHTML = `
    <div class="catalog-panel-demo">
      <h3>${FIXTURE.agentId}</h3>
      <p>GNSS sigma ${FIXTURE.gnssSigmaM.toFixed(3)}</p>
      <p>GNSS ${FIXTURE.gnssPosition.join(", ")}</p>
      <p>reference ${FIXTURE.referencePosition.join(", ")}</p>
    </div>
  `;
  return section.element;
}
