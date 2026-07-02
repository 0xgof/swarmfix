import { BufferGeometry, PerspectiveCamera, Scene, WebGLRenderer } from "three";

import { createNodeObject } from "../../renderers/NodeRenderer";
import { buildUwbCordPoints, createUwbLink } from "../../renderers/UwbLinkRenderer";
import { createViewerMaterials } from "../../style/createMaterials";
import { layerStyles } from "../../style/layerStyles";
import { toVector3 } from "../../utils/geometry";
import { createCatalogSection } from "../CatalogSection";
import { createPropHandle, createStageOrbitControls } from "../stageInteraction";

const cordStart = [-1, 0, 0];
const cordEnd = [1, 0, 0];

export function createUwbLinkSection(): HTMLElement {
  let animationFrame: number | null = null;
  let sigmaM = 0.3;
  const section = createCatalogSection({
    title: "UWB Link",
    subtitle: "Animated vibrating cord - amplitude scales with sigma",
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
  camera.position.set(0, 1, 4);
  camera.lookAt(0, 0, 0);
  scene.add(createNodeObject(cordStart, layerStyles.truth.marker));
  scene.add(createNodeObject(cordEnd, layerStyles.fusedEstimate.marker));
  const cord = createUwbLink(cordStart, cordEnd, sigmaM, 0, "agent_0", "agent_1");
  scene.add(cord);
  const controls = createStageOrbitControls(camera, renderer.domElement);

  function rebuildCord(timeSeconds: number): void {
    const cordPoints = buildUwbCordPoints(
      cordStart,
      cordEnd,
      sigmaM,
      timeSeconds,
      "agent_0",
      "agent_1"
    );
    cord.geometry.dispose();
    cord.geometry = new BufferGeometry().setFromPoints(
      cordPoints.map((point) => toVector3(point, -0.01))
    );
  }

  function animate(): void {
    rebuildCord(performance.now() / 1000);
    controls.update();
    renderer.render(scene, camera);
    animationFrame = requestAnimationFrame(animate);
  }

  renderer.render(scene, camera);
  section.stage.append(renderer.domElement);
  section.stage.append(createPropHandle({
    label: "sigma (m)",
    min: 0,
    max: 2,
    step: 0.05,
    value: sigmaM,
    onInput: (nextSigmaM) => {
      sigmaM = nextSigmaM;
      rebuildCord(performance.now() / 1000);
      renderer.render(scene, camera);
    }
  }));
  return section.element;
}
