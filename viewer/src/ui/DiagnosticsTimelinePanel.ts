import type { ViewerDiagnosticSample } from "./DiagnosticsTimelineHistory";

const SVG_NS = "http://www.w3.org/2000/svg";
const VIEWBOX_WIDTH = 600;
const VIEWBOX_HEIGHT = 86;
const PLOT_PADDING_X = 12;
const PLOT_PADDING_Y = 10;
const BEZIER_SMOOTHING = 0.18;

interface PlotPoint {
  x: number;
  y: number;
}

type SampleValueReader = (sample: ViewerDiagnosticSample) => number | undefined;

function formatNumber(value: number): string {
  const formatted = value.toFixed(3);
  return formatted;
}

function formatMeters(value: number): string {
  const formatted = `${value.toFixed(3)} m`;
  return formatted;
}

function isFiniteNumber(value: number | undefined): value is number {
  const finite = typeof value === "number" && Number.isFinite(value);
  return finite;
}

function valueRange(values: number[]): { min: number; max: number } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    const range = { min: min - 1, max: max + 1 };
    return range;
  }
  return { min, max };
}

function pointsForSeries(samples: ViewerDiagnosticSample[],
                         readValue: SampleValueReader,
                         rangeOverride?: { min: number; max: number }): PlotPoint[] {
  if (samples.length === 0) {
    return [];
  }
  const timestamps = samples.map((sample) => sample.timestampMs);
  const values = samples.map(readValue).filter(isFiniteNumber);
  if (values.length === 0) {
    return [];
  }
  const minTimestamp = Math.min(...timestamps);
  const maxTimestamp = Math.max(...timestamps);
  const timeSpan = Math.max(1, maxTimestamp - minTimestamp);
  const range = rangeOverride ?? valueRange(values);
  const valueSpan = Math.max(1e-9, range.max - range.min);
  const width = VIEWBOX_WIDTH - PLOT_PADDING_X * 2;
  const height = VIEWBOX_HEIGHT - PLOT_PADDING_Y * 2;
  const points = samples.flatMap((sample) => {
    const sampleValue = readValue(sample);
    if (!isFiniteNumber(sampleValue)) {
      return [];
    }
    const x = PLOT_PADDING_X + ((sample.timestampMs - minTimestamp) / timeSpan) * width;
    const normalizedY = (sampleValue - range.min) / valueSpan;
    const y = VIEWBOX_HEIGHT - PLOT_PADDING_Y - normalizedY * height;
    const point = { x, y };
    return [point];
  });
  return points;
}

function linePathForPoints(points: PlotPoint[]): string {
  const commands = points.map((point, index) => {
    const command = `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    return command;
  });
  const path = commands.join(" ");
  return path;
}

function bezierPathForPoints(points: PlotPoint[]): string {
  if (points.length <= 2) {
    return linePathForPoints(points);
  }

  const commands = [`M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`];
  for (let index = 0; index < points.length - 1; index += 1) {
    const previousPoint = points[Math.max(0, index - 1)];
    const currentPoint = points[index];
    const nextPoint = points[index + 1];
    const followingPoint = points[Math.min(points.length - 1, index + 2)];
    const controlStart = {
      x: currentPoint.x + (nextPoint.x - previousPoint.x) * BEZIER_SMOOTHING,
      y: currentPoint.y + (nextPoint.y - previousPoint.y) * BEZIER_SMOOTHING
    };
    const controlEnd = {
      x: nextPoint.x - (followingPoint.x - currentPoint.x) * BEZIER_SMOOTHING,
      y: nextPoint.y - (followingPoint.y - currentPoint.y) * BEZIER_SMOOTHING
    };
    const command = (
      `C${controlStart.x.toFixed(2)} ${controlStart.y.toFixed(2)} `
      + `${controlEnd.x.toFixed(2)} ${controlEnd.y.toFixed(2)} `
      + `${nextPoint.x.toFixed(2)} ${nextPoint.y.toFixed(2)}`
    );
    commands.push(command);
  }

  const path = commands.join(" ");
  return path;
}

function pathForSeries(samples: ViewerDiagnosticSample[],
                       readValue: SampleValueReader,
                       rangeOverride?: { min: number; max: number }): string {
  const points = pointsForSeries(samples, readValue, rangeOverride);
  const path = bezierPathForPoints(points);
  return path;
}

interface SecondaryPlotSeries {
  currentText: string;
  readValue: SampleValueReader;
}

function createPlot(title: string,
                    currentText: string,
                    samples: ViewerDiagnosticSample[],
                    readValue: SampleValueReader,
                    secondarySeries?: SecondaryPlotSeries): HTMLElement {
  const section = document.createElement("section");
  section.className = "diagnostics-timeline-plot";
  const header = document.createElement("div");
  header.className = "diagnostics-timeline-header";
  const label = document.createElement("span");
  label.textContent = title;
  const current = document.createElement("span");
  current.textContent = secondarySeries
    ? `${currentText} | ${secondarySeries.currentText}`
    : currentText;
  header.append(label, current);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", title);
  const rangeValues = samples.flatMap((sample) => {
    const values = [];
    const primaryValue = readValue(sample);
    if (isFiniteNumber(primaryValue)) {
      values.push(primaryValue);
    }
    if (secondarySeries) {
      const secondaryValue = secondarySeries.readValue(sample);
      if (isFiniteNumber(secondaryValue)) {
        values.push(secondaryValue);
      }
    }
    return values;
  });
  const sharedRange = valueRange(rangeValues);
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("class", "diagnostics-timeline-path");
  path.setAttribute("d", pathForSeries(samples, readValue, sharedRange));
  svg.append(path);
  if (secondarySeries) {
    const secondaryPath = document.createElementNS(SVG_NS, "path");
    secondaryPath.setAttribute(
      "class",
      "diagnostics-timeline-path diagnostics-timeline-path-secondary"
    );
    secondaryPath.setAttribute("d", pathForSeries(
      samples,
      secondarySeries.readValue,
      sharedRange
    ));
    svg.append(secondaryPath);
  }
  section.append(header, svg);
  return section;
}

export interface DiagnosticsTimelinePanelOptions {
  onReset?: () => void;
}

export class DiagnosticsTimelinePanel {
  readonly element: HTMLElement;
  private onReset: (() => void) | null;
  private resetButton: HTMLButtonElement | null;

  constructor(options: DiagnosticsTimelinePanelOptions = {}) {
    this.element = document.createElement("section");
    this.element.className = "diagnostics-timeline-panel";
    this.onReset = options.onReset ?? null;
    this.resetButton = null;
  }

  update(samples: ViewerDiagnosticSample[]): void {
    this.clearRenderedContent();
    const title = document.createElement("div");
    title.className = "diagnostics-timeline-title";
    const titleText = document.createElement("span");
    titleText.textContent = "Diagnostics timelines";
    const windowLabel = document.createElement("span");
    windowLabel.className = "diagnostics-timeline-window";
    windowLabel.textContent = "last 60 s";
    const resetButton = document.createElement("button");
    resetButton.className = "diagnostics-timeline-reset";
    resetButton.type = "button";
    resetButton.textContent = "Reset";
    resetButton.addEventListener("click", this.handleReset);
    this.resetButton = resetButton;
    const titleActions = document.createElement("span");
    titleActions.className = "diagnostics-timeline-title-actions";
    titleActions.append(windowLabel, resetButton);
    title.append(titleText, titleActions);
    this.element.append(title);

    if (samples.length === 0) {
      const empty = document.createElement("p");
      empty.className = "diagnostics-timeline-empty";
      empty.textContent = "waiting for live solver data";
      this.element.append(empty);
      return;
    }

    const latestSample = samples[samples.length - 1];
    const gnssOverlay = isFiniteNumber(latestSample.gnssErrorRmseM)
      ? {
        currentText: `GNSS ${formatMeters(latestSample.gnssErrorRmseM)}`,
        readValue: (sample: ViewerDiagnosticSample) => sample.gnssErrorRmseM
      }
      : undefined;
    this.element.append(
      createPlot(
        "cost vs time",
        formatNumber(latestSample.costTotal),
        samples,
        (sample) => sample.costTotal
      ),
      createPlot(
        "error vs time",
        formatMeters(latestSample.errorRmseM),
        samples,
        (sample) => sample.errorRmseM,
        gnssOverlay
      )
    );
  }

  dispose(): void {
    this.clearRenderedContent();
    this.element.remove();
  }

  private clearRenderedContent(): void {
    this.resetButton?.removeEventListener("click", this.handleReset);
    this.resetButton = null;
    this.element.innerHTML = "";
  }

  private handleReset = (): void => {
    this.onReset?.();
  };
}
