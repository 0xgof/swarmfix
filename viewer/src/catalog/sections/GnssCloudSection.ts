import { PerspectiveCamera, Scene, WebGLRenderer } from "three";

import { animatedGaussianScale } from "../../animation/liveMotion";
import { createGnssBell } from "../../renderers/GnssBellRenderer";
import { createNodeObject } from "../../renderers/NodeRenderer";
import { createViewerMaterials } from "../../style/createMaterials";
import { layerStyles } from "../../style/layerStyles";
import { createCatalogSection } from "../CatalogSection";
import { createPropHandle, createStageOrbitControls } from "../stageInteraction";

export function createGnssCloudSection(): HTMLElement {
  let animationFrame: number | null = null;
  let sigmaM = 1;
  const section = createCatalogSection({
    title: "GNSS Uncertainty Cloud",
    subtitle: "Gaussian bell - width encodes sigma",
    onVisible: () => { animationFrame = requestAnimationFrame(animate); },
    onHidden: () => {
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
    }
  });
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setSize(600, 400);
  const scene = new Scene();
  scene.background = createViewerMaterials().background;
  const camera = new PerspectiveCamera(45, 600 / 400, 0.1, 100);
  camera.position.set(0, 1.2, 4);
  camera.lookAt(0, 0, 0);
  const bell = createGnssBell([0, 0, 0], 1);
  bell.scale.set(sigmaM, 1, sigmaM);
  scene.add(bell);
  scene.add(createNodeObject([0, 0, 0], layerStyles.truth.marker));
  const controls = createStageOrbitControls(camera, renderer.domElement);

  function animate(): void {
    const pulsedScale = animatedGaussianScale("agent_0", sigmaM, performance.now() / 1000);
    bell.scale.set(pulsedScale, 1, pulsedScale);
    controls.update();
    renderer.render(scene, camera);
    animationFrame = requestAnimationFrame(animate);
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
      bell.scale.set(sigmaM, 1, sigmaM);
      renderer.render(scene, camera);
    }
  }));
  return section.element;
}
