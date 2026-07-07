import type { SceneTrace } from "../data/sceneTypes";
import type { LayerControlItem } from "../ui/LayerControls";
import type { IterationSliderProps } from "../ui/IterationSlider";
import type { LayerVisibility } from "./ViewerState";

type LayerGroup = "Inputs" | "Solver output" | "Static scene" | "Diagnostics";

interface LayerDefinition {
  key: keyof LayerVisibility;
  label: string;
  group: LayerGroup;
  unavailableReason: (sceneTrace: SceneTrace, layers: LayerVisibility) => string | null;
}

export interface IterationControlModel extends Omit<IterationSliderProps, "onChange"> {
  reason: string;
}

function estimateCount(sceneTrace: SceneTrace, estimateName: string): number {
  const count = sceneTrace.estimates[estimateName]?.length ?? 0;
  return count;
}

function traceHasGnssResiduals(sceneTrace: SceneTrace): boolean {
  const hasGnssResiduals = sceneTrace.trace.iterations.some((iteration) => (
    iteration.residuals.gnss.length > 0
  ));
  return hasGnssResiduals;
}

const layerDefinitions: LayerDefinition[] = [
  {
    key: "truth",
    label: "truth",
    group: "Inputs",
    unavailableReason: (sceneTrace) => (
      sceneTrace.truth.nodes.length > 0 ? null : "No truth positions are available."
    )
  },
  {
    key: "gnss",
    label: "GNSS measurement",
    group: "Inputs",
    unavailableReason: (sceneTrace) => (
      sceneTrace.measurements.gnss.length > 0 ? null : "No GNSS measurements are available."
    )
  },
  {
    key: "gnssUncertainty",
    label: "GNSS sigma",
    group: "Inputs",
    unavailableReason: (sceneTrace) => (
      sceneTrace.measurements.gnss.length > 0 ? null : "No GNSS measurements are available."
    )
  },
  {
    key: "uwbLinks",
    label: "UWB cords",
    group: "Inputs",
    unavailableReason: (sceneTrace) => (
      sceneTrace.measurements.uwb.length > 0 ? null : "No UWB measurements are available."
    )
  },
  {
    key: "fused",
    label: "fused solver output",
    group: "Solver output",
    unavailableReason: (sceneTrace) => (
      estimateCount(sceneTrace, "fused") > 0 ? null : "No fused estimates are available."
    )
  },
  {
    key: "corrected",
    label: "corrected",
    group: "Static scene",
    unavailableReason: (sceneTrace) => (
      estimateCount(sceneTrace, "corrected") > 0 ? null : "No corrected estimates are available."
    )
  },
  {
    key: "references",
    label: "reference",
    group: "Static scene",
    unavailableReason: (sceneTrace) => (
      sceneTrace.measurements.references.length > 0
        ? null
        : "No reference measurements are available."
    )
  },
  {
    key: "positionError",
    label: "position error",
    group: "Diagnostics",
    unavailableReason: (_sceneTrace, layers) => (
      layers.truth && layers.fused
        ? null
        : "Requires truth and fused layers to be visible."
    )
  },
  {
    key: "residuals",
    label: "GNSS residuals",
    group: "Diagnostics",
    unavailableReason: (sceneTrace) => (
      traceHasGnssResiduals(sceneTrace) ? null : "No GNSS residuals are available."
    )
  }
];

export function buildLayerControlItems(sceneTrace: SceneTrace,
                                       layers: LayerVisibility): LayerControlItem[] {
  const items = layerDefinitions.map((definition) => {
    const reason = definition.unavailableReason(sceneTrace, layers);
    const item = {
      key: definition.key,
      label: definition.label,
      group: definition.group,
      visible: layers[definition.key],
      disabled: reason !== null,
      reason: reason ?? undefined
    };
    return item;
  });
  return items;
}

export function buildIterationControlModel(sceneTrace: SceneTrace,
                                           selectedIteration: number,
                                           liveMode: boolean): IterationControlModel {
  const maxIteration = Math.max(0, sceneTrace.trace.iterations.length - 1);
  const label = liveMode ? "exported trace iteration" : "iteration";
  const reason = liveMode
    ? "Inspects exported trace state; the main scene uses the latest live solver frame."
    : "Scrubs the exported solver trace.";
  const model = {
    min: 0,
    max: maxIteration,
    value: Math.min(maxIteration, Math.max(0, selectedIteration)),
    label,
    disabled: maxIteration === 0,
    reason
  };
  return model;
}
