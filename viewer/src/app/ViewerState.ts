import type { SceneTrace, TraceIteration } from "../data/sceneTypes";

export interface LayerVisibility {
  truth: boolean;
  gnss: boolean;
  gnssUncertainty: boolean;
  gnssOnly: boolean;
  fused: boolean;
  corrected: boolean;
  references: boolean;
  uwbLinks: boolean;
  residuals: boolean;
  cost: boolean;
}

export interface ViewerState {
  sceneTrace: SceneTrace;
  selectedIteration: number;
  playbackSpeed: number;
  maxUwbLinksPerAgent: number;
  motionAmplitudeM: number;
  layers: LayerVisibility;
  selectedNodeId: string | null;
  selectedEdgeKey: string | null;
  setIteration: (iteration: number) => void;
  getSelectedTraceIteration: () => TraceIteration | null;
  setLayerVisible: (layer: keyof LayerVisibility, visible: boolean) => void;
  setMaxUwbLinksPerAgent: (linkCount: number) => void;
  setMotionAmplitude: (motionAmplitudeM: number) => void;
  selectNode: (agentId: string | null) => void;
  selectEdge: (edgeKey: string | null) => void;
}

function maxIterationIndex(sceneTrace: SceneTrace): number {
  const maxIndex = Math.max(0, sceneTrace.trace.iterations.length - 1);
  return maxIndex;
}

export function createViewerState(sceneTrace: SceneTrace): ViewerState {
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
    maxUwbLinksPerAgent: maxObservedUwbDegree,
    motionAmplitudeM: 0.24,
    layers: {
      truth: true,
      gnss: true,
      gnssUncertainty: true,
      gnssOnly: true,
      fused: true,
      corrected: true,
      references: true,
      uwbLinks: true,
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
        maxObservedUwbDegree,
        Math.max(0, Math.floor(linkCount))
      );
    },
    setMotionAmplitude(motionAmplitudeM: number): void {
      state.motionAmplitudeM = Math.max(0, motionAmplitudeM);
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
