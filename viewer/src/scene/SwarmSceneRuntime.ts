import {
  BufferGeometry,
  Group,
  Line,
  Object3D,
  Scene
} from "three";

import { liftPositionTo3D } from "../animation/liveMotion";
import type { LayerVisibility } from "../app/ViewerState";
import type { DisplayPositionOverrides } from "../app/DisplayFrameSmoother";
import type { SceneTrace } from "../data/sceneTypes";
import type { LiveSolveResponse } from "../live/liveSolveTypes";
import {
  fusedPositionMap,
  gnssOnlyPositionMap,
  latestTraceIteration
} from "../live/liveSolveTypes";
import { createCostGlyph } from "../renderers/CostGlyphRenderer";
import { createGnssGroundUncertainty } from "../renderers/GnssGroundUncertaintyRenderer";
import { createNodeObject } from "../renderers/NodeRenderer";
import { createPositionErrorLine } from "../renderers/PositionErrorRenderer";
import { createResidualVector } from "../renderers/ResidualVectorRenderer";
import {
  buildUwbCordPoints,
  createUwbLink
} from "../renderers/UwbLinkRenderer";
import type { LiveEstimationFrame } from "../simulation/liveEstimation";
import type { MissionActionState } from "../simulation/missionActions";
import { layerStyles, type MarkerStyle } from "../style/layerStyles";
import { createViewerMaterials } from "../style/createMaterials";
import { toVector3 } from "../utils/geometry";
import { disposeSceneGraph } from "./disposeScene";
import { createGrid } from "./grid";
import { createLights } from "./lights";

export interface SwarmSceneFrame {
  sceneTrace: SceneTrace;
  selectedIteration: number;
  layers: LayerVisibility;
  timeSeconds: number;
  maxUwbLinksPerAgent: number;
  motionAmplitudeM: number;
  displayFrame: LiveSolveResponse | null;
  missionAction: MissionActionState | null;
  liveFrame: LiveEstimationFrame;
  displayPositions?: DisplayPositionOverrides;
}

type MarkerLayerKey = "truth" | "gnss" | "gnssOnly" | "fused" | "corrected" | "references";

type DisposableObject = Object3D & {
  geometry?: BufferGeometry;
  material?: { dispose: () => void } | Array<{ dispose: () => void }>;
};

function disposeObject(object: Object3D): void {
  object.traverse((candidate) => {
    const disposable = candidate as DisposableObject;
    disposable.geometry?.dispose();
    if (Array.isArray(disposable.material)) {
      for (const material of disposable.material) {
        material.dispose();
      }
    } else {
      disposable.material?.dispose();
    }
  });
}

function markerPosition(position: number[]): ReturnType<typeof toVector3> {
  const vector = toVector3(position, 0.1);
  return vector;
}

function linkKey(sourceId: string, targetId: string): string {
  const key = `${sourceId}->${targetId}`;
  return key;
}

function updateLineGeometry(line: Line, points: number[][], yOffset = 0): void {
  const geometry = line.geometry as BufferGeometry;
  geometry.setFromPoints(points.map((point) => toVector3(point, yOffset)));
  geometry.attributes.position.needsUpdate = true;
  geometry.computeBoundingSphere();
}

export class SwarmSceneRuntime {
  readonly scene: Scene;
  private markers: Record<MarkerLayerKey, Map<string, Object3D>>;
  private markerGroups: Record<MarkerLayerKey, Group>;
  private uwbLinks: Map<string, Line>;
  private uwbGroup: Group;
  private positionErrors: Map<string, Line>;
  private positionErrorGroup: Group;
  private residuals: Map<string, Line>;
  private residualGroup: Group;
  private costs: Map<string, Object3D>;
  private costGroup: Group;

  constructor() {
    this.scene = new Scene();
    this.scene.background = createViewerMaterials().background;
    this.scene.add(createLights());
    this.scene.add(createGrid());
    this.markers = {
      truth: new Map(),
      gnss: new Map(),
      gnssOnly: new Map(),
      fused: new Map(),
      corrected: new Map(),
      references: new Map()
    };
    this.markerGroups = {
      truth: new Group(),
      gnss: new Group(),
      gnssOnly: new Group(),
      fused: new Group(),
      corrected: new Group(),
      references: new Group()
    };
    this.uwbLinks = new Map();
    this.uwbGroup = new Group();
    this.positionErrors = new Map();
    this.positionErrorGroup = new Group();
    this.residuals = new Map();
    this.residualGroup = new Group();
    this.costs = new Map();
    this.costGroup = new Group();

    for (const group of Object.values(this.markerGroups)) {
      this.scene.add(group);
    }
    this.scene.add(
      this.uwbGroup,
      this.positionErrorGroup,
      this.residualGroup,
      this.costGroup
    );
  }

  updateFrame(frame: SwarmSceneFrame): void {
    const liveFrame = frame.liveFrame;
    const fusedPositions = frame.displayPositions?.fused
      ?? fusedPositionMap(frame.displayFrame);
    const gnssOnlyPositions = frame.displayPositions?.gnssOnly
      ?? gnssOnlyPositionMap(frame.displayFrame);
    const traceIteration = latestTraceIteration(frame.displayFrame);

    this.syncMarkerLayer(
      "truth",
      liveFrame.truthPositions,
      layerStyles.truth.marker,
      frame.layers.truth
    );
    this.syncMarkerLayer(
      "gnss",
      liveFrame.gnssPositions,
      layerStyles.gnssMeasurement.marker,
      frame.layers.gnss
    );
    this.syncMarkerLayer(
      "gnssOnly",
      gnssOnlyPositions.size > 0 ? gnssOnlyPositions : liveFrame.gnssPositions,
      layerStyles.gnssOnlyEstimate.marker,
      frame.layers.gnssOnly
    );
    this.syncMarkerLayer(
      "fused",
      fusedPositions,
      layerStyles.fusedEstimate.marker,
      frame.layers.fused
    );
    this.syncStaticMarkers(
      "corrected",
      new Map((frame.sceneTrace.estimates.corrected ?? []).map((estimate) => [
        estimate.agent_id,
        estimate.position_m
      ])),
      layerStyles.correctedEstimate.marker,
      frame.layers.corrected
    );
    this.syncStaticMarkers(
      "references",
      new Map(frame.sceneTrace.measurements.references.map((reference) => [
        reference.agent_id,
        liftPositionTo3D(reference.position_m)
      ])),
      layerStyles.reference.marker,
      frame.layers.references
    );
    this.syncGnssUncertainty(liveFrame, frame.layers.gnssUncertainty);
    this.syncUwbLinks(liveFrame, fusedPositions, frame.layers.uwbLinks, frame.timeSeconds);
    this.syncPositionErrors(
      liveFrame,
      fusedPositions,
      frame.layers.positionError && frame.layers.truth && frame.layers.fused
    );
    this.syncResiduals(
      traceIteration?.gnss_residuals ?? [],
      liveFrame,
      fusedPositions,
      frame.layers.residuals
    );
    this.syncCosts(
      traceIteration?.gnss_residuals ?? [],
      fusedPositions,
      frame.layers.cost
    );
  }

  dispose(): void {
    disposeSceneGraph(this.scene);
    for (const layer of Object.values(this.markers)) {
      layer.clear();
    }
    this.uwbLinks.clear();
    this.positionErrors.clear();
    this.residuals.clear();
    this.costs.clear();
  }

  private syncMarkerLayer(layer: MarkerLayerKey,
                          positions: Map<string, number[]>,
                          style: MarkerStyle,
                          visible: boolean): void {
    this.syncStaticMarkers(layer, positions, style, visible);
  }

  private syncStaticMarkers(layer: MarkerLayerKey,
                            positions: Map<string, number[]>,
                            style: MarkerStyle,
                            visible: boolean): void {
    const group = this.markerGroups[layer];
    const markerMap = this.markers[layer];
    group.visible = visible;

    for (const [agentId, marker] of markerMap.entries()) {
      if (!positions.has(agentId)) {
        group.remove(marker);
        disposeObject(marker);
        markerMap.delete(agentId);
      }
    }

    for (const [agentId, position] of positions.entries()) {
      let marker = markerMap.get(agentId);
      if (!marker) {
        marker = createNodeObject(position, style);
        marker.userData = { kind: "node", agentId, layer };
        markerMap.set(agentId, marker);
        group.add(marker);
      }
      marker.visible = visible;
      marker.position.copy(markerPosition(position));
    }
  }

  private syncGnssUncertainty(liveFrame: LiveEstimationFrame, visible: boolean): void {
    const layer = "gnss" as const;
    for (const [agentId, marker] of this.markers[layer].entries()) {
      marker.visible = visible || this.markerGroups[layer].visible;
      void agentId;
    }
    if (!visible) {
      return;
    }
    for (const [agentId, gnssPosition] of liveFrame.gnssPositions.entries()) {
      const sigmaM = liveFrame.gnssSigma.get(agentId) ?? 1.0;
      let uncertainty = this.markers.references.get(`gnss-sigma-${agentId}`);
      if (!uncertainty) {
        uncertainty = createGnssGroundUncertainty(gnssPosition, sigmaM);
        uncertainty.userData = { kind: "node", agentId, layer: "gnssUncertainty" };
        this.markers.references.set(`gnss-sigma-${agentId}`, uncertainty);
        this.markerGroups.references.add(uncertainty);
      }
      uncertainty.visible = true;
      uncertainty.position.copy(toVector3(gnssPosition, 0.004));
    }
  }

  private syncUwbLinks(liveFrame: LiveEstimationFrame,
                       fusedPositions: Map<string, number[]>,
                       visible: boolean,
                       timeSeconds: number): void {
    this.uwbGroup.visible = visible;
    const activeKeys = new Set<string>();
    for (const link of liveFrame.uwbLinks) {
      const sourcePosition = fusedPositions.get(link.sourceId)
        ?? liveFrame.truthPositions.get(link.sourceId);
      const targetPosition = fusedPositions.get(link.targetId)
        ?? liveFrame.truthPositions.get(link.targetId);
      if (!sourcePosition || !targetPosition) {
        continue;
      }
      const key = linkKey(link.sourceId, link.targetId);
      activeKeys.add(key);
      let line = this.uwbLinks.get(key);
      if (!line) {
        line = createUwbLink(
          sourcePosition,
          targetPosition,
          link.sigmaM,
          timeSeconds,
          link.sourceId,
          link.targetId
        );
        line.userData = {
          kind: "edge",
          sourceId: link.sourceId,
          targetId: link.targetId
        };
        this.uwbLinks.set(key, line);
        this.uwbGroup.add(line);
      }
      line.visible = visible;
      const points = buildUwbCordPoints(
        sourcePosition,
        targetPosition,
        link.sigmaM,
        timeSeconds,
        link.sourceId,
        link.targetId
      );
      updateLineGeometry(line, points, -0.01);
    }

    for (const [key, line] of this.uwbLinks.entries()) {
      if (!activeKeys.has(key)) {
        this.uwbGroup.remove(line);
        disposeObject(line);
        this.uwbLinks.delete(key);
      }
    }
  }

  private syncPositionErrors(liveFrame: LiveEstimationFrame,
                             fusedPositions: Map<string, number[]>,
                             visible: boolean): void {
    this.positionErrorGroup.visible = visible;
    if (!visible) {
      this.clearObjectMap(this.positionErrors, this.positionErrorGroup);
      return;
    }

    const activeKeys = new Set<string>();
    for (const [agentId, truthPosition] of liveFrame.truthPositions.entries()) {
      const fusedPosition = fusedPositions.get(agentId);
      if (!fusedPosition) {
        continue;
      }
      activeKeys.add(agentId);
      let line = this.positionErrors.get(agentId);
      if (!line) {
        line = createPositionErrorLine(agentId, truthPosition, fusedPosition);
        this.positionErrors.set(agentId, line);
        this.positionErrorGroup.add(line);
      }
      line.visible = visible;
      updateLineGeometry(line, [truthPosition, fusedPosition], 0.12);
    }

    this.removeInactiveObjects(this.positionErrors, this.positionErrorGroup, activeKeys);
  }

  private syncResiduals(residuals: Array<{ agent_id: string }>,
                        liveFrame: LiveEstimationFrame,
                        fusedPositions: Map<string, number[]>,
                        visible: boolean): void {
    this.residualGroup.visible = visible;
    if (!visible) {
      return;
    }

    const activeKeys = new Set<string>();
    for (const residual of residuals) {
      const currentPosition = fusedPositions.get(residual.agent_id);
      const gnssPosition = liveFrame.gnssPositions.get(residual.agent_id);
      if (!currentPosition || !gnssPosition) {
        continue;
      }
      activeKeys.add(residual.agent_id);
      let line = this.residuals.get(residual.agent_id);
      if (!line) {
        line = createResidualVector(currentPosition, gnssPosition);
        this.residuals.set(residual.agent_id, line);
        this.residualGroup.add(line);
      }
      updateLineGeometry(line, [currentPosition, gnssPosition], 0.05);
    }
    this.removeInactiveObjects(this.residuals, this.residualGroup, activeKeys);
  }

  private syncCosts(residuals: Array<{ agent_id: string; weighted_sq: number }>,
                    fusedPositions: Map<string, number[]>,
                    visible: boolean): void {
    this.costGroup.visible = visible;
    if (!visible) {
      return;
    }

    const activeKeys = new Set<string>();
    const maxCost = Math.max(1, ...residuals.map((residual) => residual.weighted_sq));
    for (const residual of residuals) {
      const currentPosition = fusedPositions.get(residual.agent_id);
      if (!currentPosition) {
        continue;
      }
      activeKeys.add(residual.agent_id);
      let glyph = this.costs.get(residual.agent_id);
      if (!glyph) {
        glyph = createCostGlyph(currentPosition, residual.weighted_sq, maxCost);
        this.costs.set(residual.agent_id, glyph);
        this.costGroup.add(glyph);
      }
      glyph.position.copy(toVector3(currentPosition, 0.02));
    }
    this.removeInactiveObjects(this.costs, this.costGroup, activeKeys);
  }

  private clearObjectMap<T extends Object3D>(objects: Map<string, T>, group: Group): void {
    for (const object of objects.values()) {
      group.remove(object);
      disposeObject(object);
    }
    objects.clear();
  }

  private removeInactiveObjects<T extends Object3D>(objects: Map<string, T>,
                                                    group: Group,
                                                    activeKeys: Set<string>): void {
    for (const [key, object] of objects.entries()) {
      if (!activeKeys.has(key)) {
        group.remove(object);
        disposeObject(object);
        objects.delete(key);
      }
    }
  }
}
