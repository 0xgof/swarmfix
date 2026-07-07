import { PerspectiveCamera } from "three";

export function createCamera(width: number,
                             height: number): PerspectiveCamera {
  const aspect = width / Math.max(height, 1);
  const camera = new PerspectiveCamera(42, aspect, 0.1, 1000);
  camera.position.set(9, 12, 24);
  camera.lookAt(8, 0, 5);
  return camera;
}
