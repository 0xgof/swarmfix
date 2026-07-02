import type { BufferGeometry, Material, Object3D, Scene } from "three";

type DisposableSceneObject = Object3D & {
  geometry?: BufferGeometry;
  material?: Material | Material[];
};

function disposeMaterial(material: Material | Material[]): void {
  if (Array.isArray(material)) {
    for (const item of material) {
      item.dispose();
    }
    return;
  }

  material.dispose();
}

export function disposeSceneGraph(scene: Scene | null): void {
  if (!scene) {
    return;
  }

  scene.traverse((object) => {
    const disposableObject = object as DisposableSceneObject;
    disposableObject.geometry?.dispose();
    if (disposableObject.material) {
      disposeMaterial(disposableObject.material);
    }
  });
  scene.clear();
}
