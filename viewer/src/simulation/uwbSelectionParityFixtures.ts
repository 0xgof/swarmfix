/**
 * Parity fixture generation for the backend UWB selection port (BLF-003).
 *
 * Runs the canonical TypeScript selector over representative scenarios and
 * serializes inputs plus expected outputs to JSON. The committed fixture file
 * (`tests/fixtures/uwb_selection_parity.json`) is the acceptance evidence for
 * the Python port: the Python selector must reproduce these outputs, and the
 * companion vitest guard fails if this selector's behavior drifts from the
 * committed fixtures.
 *
 * Scenarios deliberately include symmetric formations with exact distance
 * ties (grid, ring) because tie-breaking is where cross-language ordering
 * differences surface. Near-threshold angle-gate cases are avoided; parity
 * at the 10 degree boundary is not guaranteed across float libraries.
 */

import type { Position3D } from "../animation/liveMotion";
import type { UwbMeasurement } from "../data/sceneTypes";
import {
  selectLiveUwbLinks,
  type LiveUwbSelectionDiagnostics,
  type LiveUwbSelectionOptions,
  type SelectedLiveUwbLink
} from "./uwbLinkSelection";

const FIXTURE_SIGMA_M = 0.12;
const FIXTURE_SCHEMA_VERSION = "1";

export interface ParityFixtureOptions {
  max_links_per_agent: number;
  max_range_m: number | null;
  add_range_m: number | null;
  drop_range_m: number | null;
  max_graph_changes_per_frame: number;
  min_link_separation_deg: number;
}

export interface ParityFixtureLink {
  source_id: string;
  target_id: string;
  measured_distance_m: number;
  sigma_m: number;
  selection_reason: "retained" | "new";
}

export interface ParityFixtureDiagnostics {
  candidate_link_count: number;
  selected_link_count: number;
  max_links_per_agent: number;
  connected_component_count: number;
  isolated_agent_count: number;
  triangle_count: number;
  added_links: number;
  dropped_links: number;
}

export interface ParityFixtureScenario {
  name: string;
  positions: Record<string, [number, number, number]>;
  options: ParityFixtureOptions;
  previous_selected_links: ParityFixtureLink[];
  expected: {
    selected_links: ParityFixtureLink[];
    diagnostics: ParityFixtureDiagnostics;
  };
}

export interface ParityFixtureFile {
  schema_version: string;
  scenarios: ParityFixtureScenario[];
}

function gridPositions(rows: number,
                       columns: number,
                       spacingM: number): Record<string, [number, number, number]> {
  const positions: Record<string, [number, number, number]> = {};
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column + 1;
      positions[`agent_${index}`] = [
        (column - (columns - 1) / 2) * spacingM,
        0,
        (row - (rows - 1) / 2) * spacingM
      ];
    }
  }
  return positions;
}

function ringPositions(count: number,
                       radiusM: number): Record<string, [number, number, number]> {
  const positions: Record<string, [number, number, number]> = {};
  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count;
    positions[`agent_${index + 1}`] = [
      Math.cos(angle) * radiusM,
      0,
      Math.sin(angle) * radiusM
    ];
  }
  return positions;
}

function linePositions(count: number,
                       spacingM: number): Record<string, [number, number, number]> {
  const positions: Record<string, [number, number, number]> = {};
  for (let index = 0; index < count; index += 1) {
    positions[`agent_${index + 1}`] = [index * spacingM, 0, 0];
  }
  return positions;
}

function driftedPositions(base: Record<string, [number, number, number]>): Record<string, [number, number, number]> {
  const drifted: Record<string, [number, number, number]> = {};
  const agentIds = Object.keys(base);
  for (let index = 0; index < agentIds.length; index += 1) {
    const [x, y, z] = base[agentIds[index]];
    drifted[agentIds[index]] = [
      x + 0.35 * Math.sin(index * 1.7),
      y,
      z + 0.35 * Math.cos(index * 2.3)
    ];
  }
  return drifted;
}

function allPairMeasurements(positions: Record<string, [number, number, number]>): UwbMeasurement[] {
  const agentIds = Object.keys(positions).sort((firstId, secondId) => (
    firstId.localeCompare(secondId, undefined, { numeric: true })
  ));
  const measurements: UwbMeasurement[] = [];
  for (let sourceIndex = 0; sourceIndex < agentIds.length; sourceIndex += 1) {
    for (let targetIndex = sourceIndex + 1; targetIndex < agentIds.length; targetIndex += 1) {
      const source = positions[agentIds[sourceIndex]];
      const target = positions[agentIds[targetIndex]];
      const distance = Math.hypot(
        source[0] - target[0],
        source[1] - target[1],
        source[2] - target[2]
      );
      measurements.push({
        source_id: agentIds[sourceIndex],
        target_id: agentIds[targetIndex],
        measured_distance_m: distance,
        sigma_m: FIXTURE_SIGMA_M,
        true_distance_m: distance
      });
    }
  }
  return measurements;
}

function toSelectorOptions(options: ParityFixtureOptions): LiveUwbSelectionOptions {
  const maxRangeM = options.max_range_m ?? Number.POSITIVE_INFINITY;
  const selectorOptions: LiveUwbSelectionOptions = {
    maxLinksPerAgent: options.max_links_per_agent,
    maxRangeM,
    addRangeM: options.add_range_m ?? maxRangeM,
    dropRangeM: options.drop_range_m ?? maxRangeM * 1.1,
    preferNearby: true,
    preferUnderconnectedAgents: true,
    preferTriangleClosure: true,
    maxGraphChangesPerFrame: options.max_graph_changes_per_frame,
    minLinkSeparationDeg: options.min_link_separation_deg
  };
  return selectorOptions;
}

function toFixtureLink(link: SelectedLiveUwbLink): ParityFixtureLink {
  const fixtureLink: ParityFixtureLink = {
    source_id: link.sourceId,
    target_id: link.targetId,
    measured_distance_m: link.measuredDistanceM,
    sigma_m: link.sigmaM,
    selection_reason: link.selectionReason
  };
  return fixtureLink;
}

function toSelectorLink(link: ParityFixtureLink): SelectedLiveUwbLink {
  const selectorLink: SelectedLiveUwbLink = {
    sourceId: link.source_id,
    targetId: link.target_id,
    measuredDistanceM: link.measured_distance_m,
    sigmaM: link.sigma_m,
    selectionReason: link.selection_reason
  };
  return selectorLink;
}

function toFixtureDiagnostics(diagnostics: LiveUwbSelectionDiagnostics): ParityFixtureDiagnostics {
  const fixtureDiagnostics: ParityFixtureDiagnostics = {
    candidate_link_count: diagnostics.candidateLinkCount,
    selected_link_count: diagnostics.selectedLinkCount,
    max_links_per_agent: diagnostics.maxLinksPerAgent,
    connected_component_count: diagnostics.connectedComponentCount,
    isolated_agent_count: diagnostics.isolatedAgentCount,
    triangle_count: diagnostics.triangleCount,
    added_links: diagnostics.addedLinks,
    dropped_links: diagnostics.droppedLinks
  };
  return fixtureDiagnostics;
}

function runScenario(name: string,
                     positions: Record<string, [number, number, number]>,
                     options: ParityFixtureOptions,
                     previousSelectedLinks: ParityFixtureLink[]): ParityFixtureScenario {
  const positionMap = new Map<string, Position3D>(
    Object.entries(positions).map(([agentId, position]) => [agentId, position as Position3D])
  );
  const selection = selectLiveUwbLinks({
    positions: positionMap,
    measurements: allPairMeasurements(positions),
    options: toSelectorOptions(options),
    previousSelectedLinks: previousSelectedLinks.map(toSelectorLink)
  });
  const scenario: ParityFixtureScenario = {
    name,
    positions,
    options,
    previous_selected_links: previousSelectedLinks,
    expected: {
      selected_links: selection.selectedLinks.map(toFixtureLink),
      diagnostics: toFixtureDiagnostics(selection.diagnostics)
    }
  };
  return scenario;
}

const UNBOUNDED_DEFAULTS: Omit<ParityFixtureOptions, "max_links_per_agent"> = {
  max_range_m: null,
  add_range_m: null,
  drop_range_m: null,
  max_graph_changes_per_frame: 2,
  min_link_separation_deg: 10
};

export function buildParityFixtures(): ParityFixtureFile {
  const grid9 = gridPositions(3, 3, 3);
  const grid9InitialFill = runScenario(
    "grid9_initial_fill_cap3",
    grid9,
    { ...UNBOUNDED_DEFAULTS, max_links_per_agent: 3 },
    []
  );
  const grid9Retention = runScenario(
    "grid9_retention_budget2",
    driftedPositions(grid9),
    { ...UNBOUNDED_DEFAULTS, max_links_per_agent: 3 },
    grid9InitialFill.expected.selected_links
  );
  const grid9RangeLimited = runScenario(
    "grid9_range_limited_drop",
    grid9,
    {
      max_links_per_agent: 3,
      max_range_m: 4,
      add_range_m: 4,
      drop_range_m: 4.4,
      max_graph_changes_per_frame: 2,
      min_link_separation_deg: 10
    },
    grid9InitialFill.expected.selected_links
  );
  const ring8InitialFill = runScenario(
    "ring8_initial_fill_cap2",
    ringPositions(8, 6),
    { ...UNBOUNDED_DEFAULTS, max_links_per_agent: 2 },
    []
  );
  const line5AngleGate = runScenario(
    "line5_collinear_angle_gate",
    linePositions(5, 2),
    { ...UNBOUNDED_DEFAULTS, max_links_per_agent: 3 },
    []
  );
  const grid6CapPressure = runScenario(
    "grid6_cap1_pressure",
    gridPositions(2, 3, 3),
    { ...UNBOUNDED_DEFAULTS, max_links_per_agent: 1 },
    []
  );

  const fixtureFile: ParityFixtureFile = {
    schema_version: FIXTURE_SCHEMA_VERSION,
    scenarios: [
      grid9InitialFill,
      grid9Retention,
      grid9RangeLimited,
      ring8InitialFill,
      line5AngleGate,
      grid6CapPressure
    ]
  };
  return fixtureFile;
}
