import { Group, Scene } from "three";

import { liftPositionTo3D } from "../animation/liveMotion";
import type { SceneTrace } from "../data/sceneTypes";
import type { LayerVisibility } from "../app/ViewerState";
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
import { createUwbLink } from "../renderers/UwbLinkRenderer";
import {
  buildLiveEstimationFrame,
  type LiveEstimationFrame
} from "../simulation/liveEstimation";
import type { MissionActionState } from "../simulation/missionActions";
import { layerStyles } from "../style/layerStyles";
import { createViewerMaterials } from "../style/createMaterials";
import { createGrid } from "./grid";
import { createLights } from "./lights";

const defaultLayers: LayerVisibility = {
  truth: true,
  gnss: true,
  gnssUncertainty: true,
  gnssOnly: true,
  fused: true,
  corrected: true,
  references: true,
  uwbLinks: true,
  positionError: true,
  residuals: true,
  cost: true
};

export function createSwarmScene(sceneTrace: SceneTrace,
                                 iterationIndex: number,
                                 layers = defaultLayers,
                                 timeSeconds = 0,
                                 maxUwbLinksPerAgent = sceneTrace.measurements.uwb.length,
                                 motionAmplitudeM = 0.24,
                                 liveSolveFrame: LiveSolveResponse | null = null,
                                 missionAction: MissionActionState | null = null,
                                 selectedLiveFrame: LiveEstimationFrame | null = null): Scene {
  const scene = new Scene();
  scene.background = createViewerMaterials().background;
  scene.add(createLights());
  scene.add(createGrid());

  const group = new Group();
  const liveFrame = selectedLiveFrame ?? buildLiveEstimationFrame(
    sceneTrace,
    timeSeconds,
    maxUwbLinksPerAgent,
    motionAmplitudeM,
    missionAction
  );
  const liveFusedPositions = fusedPositionMap(liveSolveFrame);
  const liveGnssOnlyPositions = gnssOnlyPositionMap(liveSolveFrame);
  const latestIteration = latestTraceIteration(liveSolveFrame);
  if (layers.gnss || layers.gnssUncertainty) {
    for (const measurement of sceneTrace.measurements.gnss) {
      const gnssPosition = liveFrame.gnssPositions.get(measurement.agent_id);
      if (!gnssPosition) {
        continue;
      }

      if (layers.gnssUncertainty) {
        group.add(createGnssGroundUncertainty(
          gnssPosition,
          measurement.uncertainty.radius_m
        ));
      }
      if (layers.gnss) {
        const gnssObject = createNodeObject(
          gnssPosition,
          layerStyles.gnssMeasurement.marker
        );
        gnssObject.userData = { kind: "node", agentId: measurement.agent_id };
        group.add(gnssObject);
      }
    }
  }

  if (layers.uwbLinks) {
    for (const link of liveFrame.uwbLinks) {
      const sourcePosition = liveFusedPositions.get(link.sourceId)
        ?? liveFrame.truthPositions.get(link.sourceId);
      const targetPosition = liveFusedPositions.get(link.targetId)
        ?? liveFrame.truthPositions.get(link.targetId);
      if (sourcePosition && targetPosition) {
        const linkObject = createUwbLink(
          sourcePosition,
          targetPosition,
          link.sigmaM,
          timeSeconds,
          link.sourceId,
          link.targetId
        );
        linkObject.userData = {
          kind: "edge",
          sourceId: link.sourceId,
          targetId: link.targetId
        };
        group.add(linkObject);
      }
    }
  }

  if (layers.truth) {
    for (const [agentId, truthPosition] of liveFrame.truthPositions.entries()) {
      const truthObject = createNodeObject(
        truthPosition,
        layerStyles.truth.marker
      );
      truthObject.userData = { kind: "node", agentId };
      group.add(truthObject);
    }
  }

  if (layers.fused) {
    for (const [agentId, fusedPosition] of liveFusedPositions.entries()) {
      const nodeObject = createNodeObject(
        fusedPosition,
        layerStyles.fusedEstimate.marker
      );
      nodeObject.userData = { kind: "node", agentId };
      group.add(nodeObject);
    }
  }

  if (layers.positionError && layers.truth && layers.fused) {
    for (const [agentId, truthPosition] of liveFrame.truthPositions.entries()) {
      const fusedPosition = liveFusedPositions.get(agentId);
      if (fusedPosition) {
        group.add(createPositionErrorLine(agentId, truthPosition, fusedPosition));
      }
    }
  }

  if (layers.gnssOnly) {
    const gnssOnlyPositions = liveGnssOnlyPositions.size > 0
      ? liveGnssOnlyPositions
      : liveFrame.gnssPositions;
    for (const [agentId, gnssPosition] of gnssOnlyPositions.entries()) {
      const nodeObject = createNodeObject(
        gnssPosition,
        layerStyles.gnssOnlyEstimate.marker
      );
      nodeObject.userData = { kind: "node", agentId };
      group.add(nodeObject);
    }
  }

  if (layers.corrected) {
    for (const estimate of sceneTrace.estimates.corrected ?? []) {
      const nodeObject = createNodeObject(
        estimate.position_m,
        layerStyles.correctedEstimate.marker
      );
      nodeObject.userData = { kind: "node", agentId: estimate.agent_id };
      group.add(nodeObject);
    }
  }

  if (layers.references) {
    for (const reference of sceneTrace.measurements.references) {
      const referenceObject = createNodeObject(
        liftPositionTo3D(reference.position_m),
        layerStyles.reference.marker
      );
      referenceObject.userData = { kind: "node", agentId: reference.agent_id };
      group.add(referenceObject);
    }
  }

  if (layers.residuals) {
    for (const residual of latestIteration?.gnss_residuals ?? []) {
      const currentPosition = liveFusedPositions.get(residual.agent_id);
      const gnssMeasurement = liveFrame.gnssPositions.get(residual.agent_id);
      if (currentPosition && gnssMeasurement) {
        group.add(createResidualVector(currentPosition, gnssMeasurement));
      }
    }
  }

  if (layers.cost) {
    const liveCosts = (latestIteration?.gnss_residuals ?? []).map((residual) => ({
      agentId: residual.agent_id,
      weightedSq: residual.weighted_sq
    }));
    const maxCost = Math.max(1, ...liveCosts.map((cost) => cost.weightedSq));
    for (const liveCost of liveCosts) {
      const currentPosition = liveFusedPositions.get(liveCost.agentId);
      if (currentPosition) {
        group.add(createCostGlyph(currentPosition, liveCost.weightedSq, maxCost));
      }
    }
  }

  scene.add(group);
  return scene;
}
