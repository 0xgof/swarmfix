import { visualTokens } from "./visualTokens";

export type MarkerShape = "circle" | "cross" | "ring" | "diamond";

export interface MarkerStyle {
  color: string;
  opacity: number;
  size: number;
  shape: MarkerShape;
}

export interface LineStyle {
  color: string;
  opacity: number;
  lineWidth: number;
}

export interface LayerStyle {
  marker: MarkerStyle;
  line: LineStyle;
  renderOrder: number;
  opacity: number;
}

export const layerStyles = Object.freeze({
  truth: Object.freeze({
    marker: Object.freeze({
      color: "#000000",
      opacity: visualTokens.opacity.solid,
      size: visualTokens.markerSize.truth,
      shape: "cross" as MarkerShape
    }),
    line: Object.freeze({
      color: visualTokens.color.black,
      opacity: visualTokens.opacity.medium,
      lineWidth: visualTokens.lineWidth.thin
    }),
    renderOrder: visualTokens.renderOrder.markers,
    opacity: visualTokens.opacity.solid
  }),
  gnssMeasurement: Object.freeze({
    marker: Object.freeze({
      color: visualTokens.color.charcoal,
      opacity: visualTokens.opacity.strong,
      size: visualTokens.markerSize.measurement,
      shape: "circle" as MarkerShape
    }),
    line: Object.freeze({
      color: visualTokens.color.charcoal,
      opacity: visualTokens.opacity.medium,
      lineWidth: visualTokens.lineWidth.hairline
    }),
    renderOrder: visualTokens.renderOrder.markers + 1,
    opacity: visualTokens.opacity.strong
  }),
  gnssUncertainty: Object.freeze({
    marker: Object.freeze({
      color: visualTokens.color.warmGrey,
      opacity: visualTokens.opacity.subtle,
      size: visualTokens.markerSize.measurement,
      shape: "ring" as MarkerShape
    }),
    line: Object.freeze({
      color: visualTokens.color.softGrey,
      opacity: visualTokens.opacity.subtle,
      lineWidth: visualTokens.lineWidth.hairline
    }),
    renderOrder: visualTokens.renderOrder.uncertainty,
    opacity: visualTokens.opacity.subtle
  }),
  gnssOnlyEstimate: Object.freeze({
    marker: Object.freeze({
      color: visualTokens.color.softGrey,
      opacity: visualTokens.opacity.strong,
      size: visualTokens.markerSize.estimate,
      shape: "circle" as MarkerShape
    }),
    line: Object.freeze({
      color: visualTokens.color.softGrey,
      opacity: visualTokens.opacity.medium,
      lineWidth: visualTokens.lineWidth.thin
    }),
    renderOrder: visualTokens.renderOrder.markers + 2,
    opacity: visualTokens.opacity.strong
  }),
  fusedEstimate: Object.freeze({
    marker: Object.freeze({
      color: visualTokens.color.black,
      opacity: visualTokens.opacity.solid,
      size: visualTokens.markerSize.estimate,
      shape: "ring" as MarkerShape
    }),
    line: Object.freeze({
      color: visualTokens.color.black,
      opacity: visualTokens.opacity.strong,
      lineWidth: visualTokens.lineWidth.thin
    }),
    renderOrder: visualTokens.renderOrder.markers + 3,
    opacity: visualTokens.opacity.solid
  }),
  correctedEstimate: Object.freeze({
    marker: Object.freeze({
      color: visualTokens.color.amber,
      opacity: visualTokens.opacity.strong,
      size: visualTokens.markerSize.estimate,
      shape: "diamond" as MarkerShape
    }),
    line: Object.freeze({
      color: visualTokens.color.amber,
      opacity: visualTokens.opacity.medium,
      lineWidth: visualTokens.lineWidth.thin
    }),
    renderOrder: visualTokens.renderOrder.markers + 4,
    opacity: visualTokens.opacity.strong
  }),
  reference: Object.freeze({
    marker: Object.freeze({
      color: visualTokens.color.blue,
      opacity: visualTokens.opacity.strong,
      size: visualTokens.markerSize.reference,
      shape: "diamond" as MarkerShape
    }),
    line: Object.freeze({
      color: visualTokens.color.blue,
      opacity: visualTokens.opacity.medium,
      lineWidth: visualTokens.lineWidth.thin
    }),
    renderOrder: visualTokens.renderOrder.selected,
    opacity: visualTokens.opacity.strong
  }),
  uwbLink: Object.freeze({
    marker: Object.freeze({
      color: visualTokens.color.black,
      opacity: visualTokens.opacity.strong,
      size: 0.05,
      shape: "circle" as MarkerShape
    }),
    line: Object.freeze({
      color: visualTokens.color.black,
      opacity: visualTokens.opacity.strong,
      lineWidth: visualTokens.lineWidth.hairline
    }),
    renderOrder: visualTokens.renderOrder.links,
    opacity: visualTokens.opacity.strong
  }),
  gnssResidual: Object.freeze({
    marker: Object.freeze({
      color: visualTokens.color.red,
      opacity: visualTokens.opacity.medium,
      size: 0.05,
      shape: "circle" as MarkerShape
    }),
    line: Object.freeze({
      color: visualTokens.color.red,
      opacity: visualTokens.opacity.medium,
      lineWidth: visualTokens.lineWidth.thin
    }),
    renderOrder: visualTokens.renderOrder.residuals,
    opacity: visualTokens.opacity.medium
  }),
  uwbResidual: Object.freeze({
    marker: Object.freeze({
      color: visualTokens.color.red,
      opacity: visualTokens.opacity.medium,
      size: 0.05,
      shape: "circle" as MarkerShape
    }),
    line: Object.freeze({
      color: visualTokens.color.red,
      opacity: visualTokens.opacity.medium,
      lineWidth: visualTokens.lineWidth.thin
    }),
    renderOrder: visualTokens.renderOrder.residuals,
    opacity: visualTokens.opacity.medium
  }),
  referenceResidual: Object.freeze({
    marker: Object.freeze({
      color: visualTokens.color.red,
      opacity: visualTokens.opacity.medium,
      size: 0.05,
      shape: "circle" as MarkerShape
    }),
    line: Object.freeze({
      color: visualTokens.color.red,
      opacity: visualTokens.opacity.medium,
      lineWidth: visualTokens.lineWidth.thin
    }),
    renderOrder: visualTokens.renderOrder.residuals,
    opacity: visualTokens.opacity.medium
  }),
  costContribution: Object.freeze({
    marker: Object.freeze({
      color: visualTokens.color.charcoal,
      opacity: visualTokens.opacity.medium,
      size: 0.1,
      shape: "ring" as MarkerShape
    }),
    line: Object.freeze({
      color: visualTokens.color.charcoal,
      opacity: visualTokens.opacity.medium,
      lineWidth: visualTokens.lineWidth.thin
    }),
    renderOrder: visualTokens.renderOrder.residuals,
    opacity: visualTokens.opacity.medium
  })
});
