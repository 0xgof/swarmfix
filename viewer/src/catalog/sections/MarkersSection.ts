import { PerspectiveCamera, Scene, WebGLRenderer } from "three";

import { createNodeObject } from "../../renderers/NodeRenderer";
import { createViewerMaterials } from "../../style/createMaterials";
import { layerStyles } from "../../style/layerStyles";
import { visualTokens } from "../../style/visualTokens";
import { createCatalogSection } from "../CatalogSection";
import { createPropHandle, createStageOrbitControls } from "../stageInteraction";

export function createMarkersSection(): HTMLElement {
  let animationFrame: number | null = null;
  const section = createCatalogSection({
    title: "Markers",
    subtitle: "NodeRenderer shapes: cross / circle / ring / diamond",
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
  camera.position.set(0, 1.2, 4.5);
  camera.lookAt(0, 0, 0);
  const styles = [
    layerStyles.truth,
    layerStyles.gnssMeasurement,
    layerStyles.fusedEstimate,
    layerStyles.correctedEstimate,
    layerStyles.reference
  ];
  const markerNodes = styles.map((style, index) => {
    // Centre the marker row on the origin so orbiting keeps it in frame.
    const centeredX = (index - (styles.length - 1) / 2) * 0.8;
    const node = createNodeObject([centeredX, 0, 0], style.marker);
    scene.add(node);
    return node;
  });
  renderer.domElement.dataset.visualToken = visualTokens.color.black;
  const controls = createStageOrbitControls(camera, renderer.domElement);

  function animate(): void {
    controls.update();
    renderer.render(scene, camera);
    animationFrame = requestAnimationFrame(animate);
  }

  renderer.render(scene, camera);
  section.stage.append(renderer.domElement);
  section.stage.append(createPropHandle({
    label: "marker scale",
    min: 0.5,
    max: 3,
    step: 0.1,
    value: 1,
    onInput: (markerScale) => {
      for (const node of markerNodes) {
        node.scale.setScalar(markerScale);
      }
      renderer.render(scene, camera);
    }
  }));
  return section.element;
}
