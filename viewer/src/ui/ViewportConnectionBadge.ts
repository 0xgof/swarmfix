import {
  buildConnectionStatusModel,
  type ConnectionStatusInput
} from "./ConnectionStatusPanel";

const staleSnapshotNote = "3D scene shows a stale snapshot, not live solver output.";

export function createViewportConnectionBadge(props: ConnectionStatusInput): HTMLElement {
  const badge = document.createElement("div");
  badge.className = "connection-badge";
  updateViewportConnectionBadge(badge, props);
  return badge;
}

export function updateViewportConnectionBadge(badge: HTMLElement,
                                              props: ConnectionStatusInput): void {
  const statusModel = buildConnectionStatusModel(props);
  badge.dataset.tone = statusModel.tone;
  badge.innerHTML = "";

  const label = document.createElement("span");
  label.className = "connection-badge-label";
  label.textContent = statusModel.label;
  badge.append(label);

  if (props.status !== "connected") {
    const note = document.createElement("span");
    note.className = "connection-badge-note";
    note.textContent = staleSnapshotNote;
    badge.append(note);
  }
}
