import "./newton.css";

import {
  buildNormalSystemSnapshot,
  type NormalSystemSnapshot
} from "./normalSystemModel";
import {
  buildFormationElements,
  highlightForSelection,
  linkKey,
  selectionLabel,
  type FormationSelection
} from "./formationSelection";
import {
  subscribeNewtonSharedState,
  type NewtonSharedState,
  type NewtonSharedStateUnsubscribe
} from "./newtonSharedState";
import type { LiveSolveRequest } from "../live/liveSolveTypes";

export interface NewtonPageOptions {
  subscribe?: (listener: (state: NewtonSharedState) => void) => NewtonSharedStateUnsubscribe;
}

function fixtureRequest(): LiveSolveRequest {
const request: LiveSolveRequest = {
    schema_version: "0.1.0",
    dimension: 3,
    agents: [
      { agent_id: "agent_0", position_m: [0, 0, 0] },
      { agent_id: "agent_1", position_m: [2, 0, 0] }
    ],
    gnss: [
      { agent_id: "agent_0", position_m: [0, 0, 0], sigma_m: 2 },
      { agent_id: "agent_1", position_m: [4, 0, 0], sigma_m: 2 }
    ],
    uwb: [{
      source_id: "agent_0",
      target_id: "agent_1",
      distance_m: 5,
      sigma_m: 0.5,
      true_distance_m: null
    }],
    selected_uwb_links: [{ source_id: "agent_0", target_id: "agent_1" }],
    estimation: { max_iterations: 40, robust_loss: "linear" }
  };
  return request;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function formatNumber(value: number): string {
  if (Math.abs(value) < 0.0005) {
    return "0";
  }
  return value.toFixed(2);
}

function createMetric(label: string, value: string): HTMLElement {
  const metric = document.createElement("div");
  metric.className = "newton-metric";
  const metricLabel = document.createElement("span");
  metricLabel.textContent = label;
  const metricValue = document.createElement("strong");
  metricValue.textContent = value;
  metric.append(metricLabel, metricValue);
  return metric;
}

function createEquation(): HTMLElement {
  const equation = document.createElement("section");
  equation.className = "newton-equation-panel";
  const title = document.createElement("h2");
  title.textContent = "Normal System";
  const simple = document.createElement("p");
  simple.className = "newton-equation";
  simple.textContent = "J^T J delta_x = -J^T r";
  const damped = document.createElement("p");
  damped.className = "newton-equation newton-equation-muted";
  damped.textContent = "(J^T J + lambda I) delta_x = -J^T r";
  equation.append(title, simple, damped);
  return equation;
}

function createMatrix(titleText: string,
                      matrix: number[][],
                      snapshot: NormalSystemSnapshot): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "newton-matrix-panel";
  const title = document.createElement("h2");
  title.textContent = titleText;
  const grid = document.createElement("div");
  grid.className = "newton-matrix-grid";
  grid.style.setProperty("--newton-columns", String(matrix[0]?.length ?? 1));

  for (let row = 0; row < matrix.length; row += 1) {
    for (let column = 0; column < matrix[row].length; column += 1) {
      const cell = document.createElement("span");
      const value = matrix[row][column];
      cell.className = value === 0
        ? "newton-matrix-cell zero"
        : "newton-matrix-cell nonzero";
      cell.textContent = formatNumber(value);
      cell.title = `${snapshot.variableColumns[row]?.agentId ?? row} x `
        + `${snapshot.variableColumns[column]?.agentId ?? column}: ${formatNumber(value)}`;
      grid.append(cell);
    }
  }

  panel.append(title, grid);
  return panel;
}

function shouldHighlightCell(row: number,
                             column: number,
                             highlightedRows: Set<number>,
                             highlightedColumns: Set<number>): boolean {
  if (highlightedRows.size > 0 && highlightedColumns.size > 0) {
    return highlightedRows.has(row) && highlightedColumns.has(column);
  }
  if (highlightedRows.size > 0) {
    return highlightedRows.has(row);
  }
  return highlightedColumns.has(column);
}

function createJacobianMatrix(snapshot: NormalSystemSnapshot,
                              selection: FormationSelection | null): HTMLElement {
  const highlight = highlightForSelection(snapshot, selection);
  const panel = document.createElement("section");
  panel.className = "newton-matrix-panel";
  const title = document.createElement("h2");
  title.textContent = "J";
  const grid = document.createElement("div");
  grid.className = "newton-matrix-grid newton-j-grid";
  grid.style.setProperty("--newton-columns", String(snapshot.jacobian[0]?.length ?? 1));

  for (let row = 0; row < snapshot.jacobian.length; row += 1) {
    for (let column = 0; column < snapshot.jacobian[row].length; column += 1) {
      const cell = document.createElement("span");
      const value = snapshot.jacobian[row][column];
      const highlighted = shouldHighlightCell(
        row,
        column,
        highlight.rows,
        highlight.columns
      );
      cell.className = [
        "newton-matrix-cell",
        "newton-j-cell",
        value === 0 ? "zero" : "nonzero",
        highlighted ? "highlighted" : ""
      ].filter(Boolean).join(" ");
      cell.dataset.row = String(row);
      cell.dataset.column = String(column);
      cell.textContent = formatNumber(value);
      cell.title = `row ${row}, column ${column}: ${formatNumber(value)}`;
      grid.append(cell);
    }
  }

  panel.append(title, grid);
  return panel;
}

function createVector(titleText: string, values: number[]): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "newton-vector-panel";
  const title = document.createElement("h2");
  title.textContent = titleText;
  const list = document.createElement("ol");
  list.className = "newton-vector-list";
  for (const value of values) {
    const item = document.createElement("li");
    item.textContent = formatNumber(value);
    list.append(item);
  }
  panel.append(title, list);
  return panel;
}

function selectionMatchesLink(selection: FormationSelection | null,
                              sourceId: string,
                              targetId: string): boolean {
  if (selection?.kind !== "uwb") {
    return false;
  }
  return linkKey(selection.sourceId, selection.targetId) === linkKey(sourceId, targetId);
}

export class NewtonPage {
  private root: HTMLElement;
  private subscribe: (listener: (state: NewtonSharedState) => void) => NewtonSharedStateUnsubscribe;
  private unsubscribe: NewtonSharedStateUnsubscribe | null;
  private latestSharedState: NewtonSharedState | null;
  private activeSelection: FormationSelection | null;

  constructor(root: HTMLElement, options: NewtonPageOptions = {}) {
    this.root = root;
    this.subscribe = options.subscribe ?? subscribeNewtonSharedState;
    this.unsubscribe = null;
    this.latestSharedState = null;
    this.activeSelection = null;
  }

  mount(): void {
    this.unsubscribe?.();
    this.unsubscribe = this.subscribe((state) => {
      this.latestSharedState = state;
      this.render();
    });
    this.render();
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private render(): void {
    const request = this.latestSharedState?.liveSolveRequest ?? fixtureRequest();
    const snapshot = buildNormalSystemSnapshot(request, { damping: 0.25 });
    this.root.innerHTML = "";
    const page = document.createElement("main");
    page.className = "newton-page";
    page.append(
      this.createToolbar(snapshot),
      this.createContent(snapshot, request)
    );
    this.root.append(page);
  }

  private createToolbar(snapshot: NormalSystemSnapshot): HTMLElement {
    const toolbar = document.createElement("header");
    toolbar.className = "newton-toolbar";
    const title = document.createElement("div");
    title.className = "newton-title";
    const heading = document.createElement("h1");
    heading.textContent = "Newton Solver";
    const subtitle = document.createElement("p");
    const solverBackend = this.latestSharedState?.solverBackend;
    subtitle.textContent = solverBackend
      ? `linked viewer state - ${solverBackend}`
      : "diagnostic fixture - waiting for linked viewer state";
    title.append(heading, subtitle);
    const metrics = document.createElement("div");
    metrics.className = "newton-metrics";
    metrics.append(
      createMetric("J", `${snapshot.residualRows.length} x ${snapshot.variableColumns.length}`),
      createMetric("cost", formatNumber(snapshot.costBefore)),
      createMetric("damping", formatNumber(snapshot.damping)),
      createMetric("step", snapshot.accepted ? "accepted" : "rejected")
    );
    toolbar.append(title, metrics);
    return toolbar;
  }

  private createContent(snapshot: NormalSystemSnapshot, request: LiveSolveRequest): HTMLElement {
    const content = document.createElement("div");
    content.className = "newton-content";
    const swarmPane = this.createFormationPane(request);

    const systemPane = document.createElement("div");
    systemPane.className = "newton-system-pane";
    systemPane.append(
      createEquation(),
      createJacobianMatrix(snapshot, this.activeSelection),
      createMatrix("J^T J", snapshot.normalMatrix, snapshot),
      createVector("-J^T r", snapshot.rhs),
      createVector("delta_x", snapshot.delta)
    );
    content.append(swarmPane, systemPane);
    return content;
  }

  private createFormationPane(request: LiveSolveRequest): HTMLElement {
    const pane = document.createElement("section");
    pane.className = "newton-swarm-pane";
    const title = document.createElement("h2");
    title.textContent = "Static Formation";
    const body = document.createElement("div");
    body.className = "newton-formation-body";
    body.append(this.createStaticFormationView(request));

    const detail = document.createElement("p");
    detail.className = "newton-selection-detail";
    detail.textContent = selectionLabel(this.activeSelection);
    pane.append(title, body, detail);
    return pane;
  }

  private createStaticFormationView(request: LiveSolveRequest): SVGSVGElement {
    const elements = buildFormationElements(request);
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "newton-formation-view");
    svg.setAttribute("viewBox", "0 0 420 320");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Static formation diagnostic view");

    const projected = new Map<string, [number, number]>();
    const allPositions = [
      ...elements.drones.map((drone) => drone.position),
      ...elements.gnssMarkers.map((marker) => marker.position)
    ];
    const xs = allPositions.map((position) => position[0] ?? 0);
    const zs = allPositions.map((position) => position[2] ?? position[1] ?? 0);
    const minX = Math.min(...xs, 0);
    const maxX = Math.max(...xs, 1);
    const minZ = Math.min(...zs, 0);
    const maxZ = Math.max(...zs, 1);
    const spanX = Math.max(maxX - minX, 1);
    const spanZ = Math.max(maxZ - minZ, 1);
    const project = (position: number[]): [number, number] => {
      const x = 42 + (((position[0] ?? 0) - minX) / spanX) * 336;
      const y = 278 - ((((position[2] ?? position[1] ?? 0) - minZ) / spanZ) * 236);
      return [x, y];
    };

    for (const drone of elements.drones) {
      projected.set(drone.agentId, project(drone.position));
    }

    for (const link of elements.uwbLinks) {
      const source = projected.get(link.sourceId);
      const target = projected.get(link.targetId);
      if (!source || !target) {
        continue;
      }
      const line = document.createElementNS(SVG_NS, "line");
      const selected = selectionMatchesLink(this.activeSelection, link.sourceId, link.targetId);
      line.setAttribute("class", selected
        ? "newton-formation-link selected"
        : "newton-formation-link");
      line.setAttribute("x1", String(source[0]));
      line.setAttribute("y1", String(source[1]));
      line.setAttribute("x2", String(target[0]));
      line.setAttribute("y2", String(target[1]));
      line.dataset.newtonSelection = `uwb:${link.key}`;
      line.addEventListener("click", () => {
        this.activeSelection = {
          kind: "uwb",
          sourceId: link.sourceId,
          targetId: link.targetId
        };
        this.render();
      });
      svg.append(line);
    }

    for (const marker of elements.gnssMarkers) {
      const [x, y] = project(marker.position);
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("class", this.activeSelection?.kind === "gnss"
        && this.activeSelection.agentId === marker.agentId
        ? "newton-formation-gnss selected"
        : "newton-formation-gnss");
      circle.setAttribute("cx", String(x));
      circle.setAttribute("cy", String(y));
      circle.setAttribute("r", "7");
      circle.dataset.newtonSelection = `gnss:${marker.agentId}`;
      circle.addEventListener("click", () => {
        this.activeSelection = { kind: "gnss", agentId: marker.agentId };
        this.render();
      });
      svg.append(circle);
    }

    for (const drone of elements.drones) {
      const [x, y] = projected.get(drone.agentId) ?? project(drone.position);
      const group = document.createElementNS(SVG_NS, "g");
      group.setAttribute("class", this.activeSelection?.kind === "drone"
        && this.activeSelection.agentId === drone.agentId
        ? "newton-formation-drone selected"
        : "newton-formation-drone");
      group.dataset.newtonSelection = `drone:${drone.agentId}`;
      group.addEventListener("click", () => {
        this.activeSelection = { kind: "drone", agentId: drone.agentId };
        this.render();
      });
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("cx", String(x));
      circle.setAttribute("cy", String(y));
      circle.setAttribute("r", "10");
      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", String(x + 13));
      label.setAttribute("y", String(y + 4));
      label.textContent = drone.agentId;
      group.append(circle, label);
      svg.append(group);
    }

    return svg;
  }
}
