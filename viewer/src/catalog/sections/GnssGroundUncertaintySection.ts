import { PerspectiveCamera, Scene, WebGLRenderer } from "three";

import { createGnssGroundUncertainty } from "../../renderers/GnssGroundUncertaintyRenderer";
import { createNodeObject } from "../../renderers/NodeRenderer";
import { createViewerMaterials } from "../../style/createMaterials";
import { layerStyles } from "../../style/layerStyles";
import { createCatalogSection } from "../CatalogSection";
import { createPropHandle, createStageOrbitControls } from "../stageInteraction";

export function createGnssGroundUncertaintySection(): HTMLElement {
  let sigmaM = 1;
  const section = createCatalogSection({
    title: "GNSS Ground Uncertainty",
    subtitle: "Flat 1-sigma ground rings - darker at center",
    onVisible: () => undefined,
    onHidden: () => undefined
  });
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setSize(600, 400);
  const scene = new Scene();
  scene.background = createViewerMaterials().background;
  const camera = new PerspectiveCamera(45, 600 / 400, 0.1, 100);
  camera.position.set(0, 2.6, 3.4);
  camera.lookAt(0, 0, 0);
  let groundUncertainty = createGnssGroundUncertainty([0, 0, 0], sigmaM);
  scene.add(groundUncertainty);
  scene.add(createNodeObject([0, 0, 0], layerStyles.truth.marker));
  const controls = createStageOrbitControls(camera, renderer.domElement);

  function render(): void {
    controls.update();
    renderer.render(scene, camera);
  }

  renderer.render(scene, camera);
  section.stage.append(renderer.domElement);
  section.stage.append(createPropHandle({
    label: "sigma (m)",
    min: 0.2,
    max: 2,
    step: 0.1,
    value: sigmaM,
    onInput: (nextSigmaM) => {
      sigmaM = nextSigmaM;
      scene.remove(groundUncertainty);
      groundUncertainty = createGnssGroundUncertainty([0, 0, 0], sigmaM);
      scene.add(groundUncertainty);
      render();
    }
  }));
  return section.element;
}
