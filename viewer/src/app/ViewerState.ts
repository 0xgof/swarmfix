import type { SceneTrace, TraceIteration } from "../data/sceneTypes";
import {
  defaultMissionActionState,
  normalizeMissionActionState,
  type MissionActionState
} from "../simulation/missionActions";

export interface LayerVisibility {
  truth: boolean;
  gnss: boolean;
  gnssUncertainty: boolean;
  gnssOnly: boolean;
  fused: boolean;
  corrected: boolean;
  references: boolean;
  uwbLinks: boolean;
  positionError: boolean;
  residuals: boolean;
  cost: boolean;
}

export interface ViewerState {
  sceneTrace: SceneTrace;
  selectedIteration: number;
  playbackSpeed: number;
  maxUwbLinksPerAgent: number;
  motionAmplitudeM: number;
  missionAction: MissionActionState;
  layers: LayerVisibility;
  selectedNodeId: string | null;
  selectedEdgeKey: string | null;
  setIteration: (iteration: number) => void;
  getSelectedTraceIteration: () => TraceIteration | null;
  setLayerVisible: (layer: keyof LayerVisibility, visible: boolean) => void;
  setMaxUwbLinksPerAgent: (linkCount: number) => void;
  setMotionAmplitude: (motionAmplitudeM: number) => void;
  setMissionAction: (update: Partial<MissionActionState>, timeSeconds?: number) => void;
  selectNode: (agentId: string | null) => void;
  selectEdge: (edgeKey: string | null) => void;
}

function maxIterationIndex(sceneTrace: SceneTrace): number {
  const maxIndex = Math.max(0, sceneTrace.trace.iterations.length - 1);
  return maxIndex;
}

export const UWB_LINKS_PER_AGENT_LIMIT = 20;

export function maxUwbLinksPerAgentLimit(sceneTrace: SceneTrace): number {
  const agentIds = new Set<string>();
  for (const node of sceneTrace.truth.nodes) {
    agentIds.add(node.id);
  }
  for (const measurement of sceneTrace.measurements.uwb) {
    agentIds.add(measurement.source_id);
    agentIds.add(measurement.target_id);
  }

  const graphLimit = Math.max(0, agentIds.size - 1);
  const linkLimit = Math.min(UWB_LINKS_PER_AGENT_LIMIT, graphLimit);
  return linkLimit;
}

export function createViewerState(sceneTrace: SceneTrace): ViewerState {
  const linkLimit = maxUwbLinksPerAgentLimit(sceneTrace);
  const maxObservedUwbDegree = Math.max(
    0,
    ...sceneTrace.measurements.uwb.flatMap((link) => [
      sceneTrace.measurements.uwb.filter((candidate) => (
        candidate.source_id === link.source_id || candidate.target_id === link.source_id
      )).length,
      sceneTrace.measurements.uwb.filter((candidate) => (
        candidate.source_id === link.target_id || candidate.target_id === link.target_id
      )).length
    ])
  );
  const state: ViewerState = {
    sceneTrace,
    selectedIteration: 0,
    playbackSpeed: 1,
    maxUwbLinksPerAgent: Math.min(linkLimit, maxObservedUwbDegree),
    motionAmplitudeM: 0.24,
    missionAction: defaultMissionActionState(),
    layers: {
      truth: true,
      gnss: true,
      gnssUncertainty: true,
      gnssOnly: true,
      fused: true,
      corrected: true,
      references: true,
      uwbLinks: true,
      positionError: true,
      residuals: false,
      cost: false
    },
    selectedNodeId: null,
    selectedEdgeKey: null,
    setIteration(iteration: number): void {
      const boundedIteration = Math.min(
        maxIterationIndex(sceneTrace),
        Math.max(0, Math.floor(iteration))
      );
      state.selectedIteration = boundedIteration;
    },
    getSelectedTraceIteration(): TraceIteration | null {
      const selectedTrace = sceneTrace.trace.iterations[state.selectedIteration]
        ?? null;
      return selectedTrace;
    },
    setLayerVisible(layer: keyof LayerVisibility, visible: boolean): void {
      state.layers[layer] = visible;
    },
    setMaxUwbLinksPerAgent(linkCount: number): void {
      state.maxUwbLinksPerAgent = Math.min(
        linkLimit,
        Math.max(0, Math.floor(linkCount))
      );
    },
    setMotionAmplitude(motionAmplitudeM: number): void {
      state.motionAmplitudeM = Math.max(0, motionAmplitudeM);
    },
    setMissionAction(update: Partial<MissionActionState>, timeSeconds = 0): void {
      const currentFormation = state.missionAction.formation;
      const nextFormation = update.formation ?? currentFormation;
      const formationChanged = nextFormation !== currentFormation;
      const mergedAction = normalizeMissionActionState({
        ...state.missionAction,
        ...update,
        previousFormation: formationChanged
          ? currentFormation
          : state.missionAction.previousFormation,
        transitionStartedAtS: formationChanged
          ? timeSeconds
          : state.missionAction.transitionStartedAtS
      });
      state.missionAction = mergedAction;
    },
    selectNode(agentId: string | null): void {
      state.selectedNodeId = agentId;
      if (agentId !== null) {
        state.selectedEdgeKey = null;
      }
    },
    selectEdge(edgeKey: string | null): void {
      state.selectedEdgeKey = edgeKey;
      if (edgeKey !== null) {
        state.selectedNodeId = null;
      }
    }
  };
  return state;
}
