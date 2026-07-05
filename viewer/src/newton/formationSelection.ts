import type { LiveSolveRequest } from "../live/liveSolveTypes";
import type { NormalSystemSnapshot, ResidualRow } from "./normalSystemModel";

export interface FormationDroneElement {
  agentId: string;
  position: number[];
}

export interface FormationGnssElement {
  agentId: string;
  position: number[];
}

export interface FormationUwbElement {
  key: string;
  sourceId: string;
  targetId: string;
}

export interface FormationElements {
  drones: FormationDroneElement[];
  gnssMarkers: FormationGnssElement[];
  uwbLinks: FormationUwbElement[];
}

export type FormationSelection =
  | { kind: "drone"; agentId: string }
  | { kind: "gnss"; agentId: string }
  | { kind: "uwb"; sourceId: string; targetId: string };

export interface MatrixHighlight {
  rows: Set<number>;
  columns: Set<number>;
}

export function linkKey(sourceId: string, targetId: string): string {
  const key = [sourceId, targetId].sort().join("::");
  return key;
}

function rowMatchesUwb(row: ResidualRow, sourceId: string, targetId: string): boolean {
  if (row.kind !== "uwb") {
    return false;
  }
  const selectedKey = linkKey(sourceId, targetId);
  const rowKey = linkKey(row.sourceId, row.targetId);
  return rowKey === selectedKey;
}

export function buildFormationElements(request: LiveSolveRequest): FormationElements {
  const drones = request.agents.map((agent) => ({
    agentId: agent.agent_id,
    position: agent.position_m.slice(0, request.dimension)
  }));
  const gnssMarkers = request.gnss.map((measurement) => ({
    agentId: measurement.agent_id,
    position: measurement.position_m.slice(0, request.dimension)
  }));
  const uwbLinks = request.selected_uwb_links.map((link) => ({
    key: linkKey(link.source_id, link.target_id),
    sourceId: link.source_id,
    targetId: link.target_id
  }));
  return { drones, gnssMarkers, uwbLinks };
}

export function highlightForSelection(snapshot: NormalSystemSnapshot,
                                      selection: FormationSelection | null): MatrixHighlight {
  const rows = new Set<number>();
  const columns = new Set<number>();
  if (!selection) {
    return { rows, columns };
  }

  snapshot.variableColumns.forEach((column, index) => {
    if (
      (selection.kind === "drone" || selection.kind === "gnss")
      && column.agentId === selection.agentId
    ) {
      columns.add(index);
    }
    if (
      selection.kind === "uwb"
      && (column.agentId === selection.sourceId || column.agentId === selection.targetId)
    ) {
      columns.add(index);
    }
  });

  snapshot.residualRows.forEach((row, index) => {
    if (selection.kind === "gnss" && row.kind === "gnss" && row.agentId === selection.agentId) {
      rows.add(index);
    }
    if (selection.kind === "uwb" && rowMatchesUwb(row, selection.sourceId, selection.targetId)) {
      rows.add(index);
    }
  });

  return { rows, columns };
}

export function selectionLabel(selection: FormationSelection | null): string {
  if (!selection) {
    return "No element selected";
  }
  if (selection.kind === "drone") {
    return `Drone ${selection.agentId}`;
  }
  if (selection.kind === "gnss") {
    return `GNSS ${selection.agentId}`;
  }
  return `UWB ${selection.sourceId} -> ${selection.targetId}`;
}
