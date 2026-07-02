import {
  Color,
  LineBasicMaterial,
  MeshBasicMaterial,
  MeshBasicMaterialParameters
} from "three";

import { layerStyles } from "./layerStyles";
import { visualTokens } from "./visualTokens";

export interface ViewerMaterials {
  background: Color;
  truth: MeshBasicMaterial;
  gnssMeasurement: MeshBasicMaterial;
  gnssUncertainty: MeshBasicMaterial;
  gnssOnlyEstimate: MeshBasicMaterial;
  fusedEstimate: MeshBasicMaterial;
  correctedEstimate: MeshBasicMaterial;
  reference: MeshBasicMaterial;
  uwbLink: LineBasicMaterial;
  residual: LineBasicMaterial;
}

function makeMeshMaterial(color: string,
                          opacity: number): MeshBasicMaterial {
  const materialParams: MeshBasicMaterialParameters = {
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 0.5
  };
  const material = new MeshBasicMaterial(materialParams);
  return material;
}

function makeLineMaterial(color: string,
                          opacity: number): LineBasicMaterial {
  const material = new LineBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity
  });
  return material;
}

export function createViewerMaterials(): ViewerMaterials {
  const materials = {
    background: new Color(visualTokens.color.offWhite),
    truth: makeMeshMaterial(
      layerStyles.truth.marker.color,
      layerStyles.truth.marker.opacity
    ),
    gnssMeasurement: makeMeshMaterial(
      layerStyles.gnssMeasurement.marker.color,
      layerStyles.gnssMeasurement.marker.opacity
    ),
    gnssUncertainty: makeMeshMaterial(
      layerStyles.gnssUncertainty.marker.color,
      layerStyles.gnssUncertainty.marker.opacity
    ),
    gnssOnlyEstimate: makeMeshMaterial(
      layerStyles.gnssOnlyEstimate.marker.color,
      layerStyles.gnssOnlyEstimate.marker.opacity
    ),
    fusedEstimate: makeMeshMaterial(
      layerStyles.fusedEstimate.marker.color,
      layerStyles.fusedEstimate.marker.opacity
    ),
    correctedEstimate: makeMeshMaterial(
      layerStyles.correctedEstimate.marker.color,
      layerStyles.correctedEstimate.marker.opacity
    ),
    reference: makeMeshMaterial(
      layerStyles.reference.marker.color,
      layerStyles.reference.marker.opacity
    ),
    uwbLink: makeLineMaterial(
      layerStyles.uwbLink.line.color,
      layerStyles.uwbLink.line.opacity
    ),
    residual: makeLineMaterial(
      layerStyles.gnssResidual.line.color,
      layerStyles.gnssResidual.line.opacity
    )
  };
  return materials;
}
