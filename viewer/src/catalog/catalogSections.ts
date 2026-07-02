import { createConnectionStatusSection } from "./sections/ConnectionStatusSection";
import { createCostBreakdownPanelSection } from "./sections/CostBreakdownPanelSection";
import { createEdgeDetailsPanelSection } from "./sections/EdgeDetailsPanelSection";
import { createGnssCloudSection } from "./sections/GnssCloudSection";
import { createIterationSliderSection } from "./sections/IterationSliderSection";
import { createLayerControlsSection } from "./sections/LayerControlsSection";
import { createLinkCountControlSection } from "./sections/LinkCountControlSection";
import { createMarkersSection } from "./sections/MarkersSection";
import { createMeasurementInspectorSection } from "./sections/MeasurementInspectorSection";
import { createNodeDetailsPanelSection } from "./sections/NodeDetailsPanelSection";
import { createUwbLinkSection } from "./sections/UwbLinkSection";
import { createVisualTokensSection } from "./sections/VisualTokensSection";

export type CatalogSectionFactory = () => HTMLElement;

export const catalogSectionFactories: CatalogSectionFactory[] = [
  createVisualTokensSection,
  createMarkersSection,
  createUwbLinkSection,
  createGnssCloudSection,
  createLayerControlsSection,
  createIterationSliderSection,
  createLinkCountControlSection,
  createNodeDetailsPanelSection,
  createEdgeDetailsPanelSection,
  createCostBreakdownPanelSection,
  createMeasurementInspectorSection,
  createConnectionStatusSection
];
