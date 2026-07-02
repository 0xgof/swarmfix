import { AmbientLight } from "three";

export function createLights(): AmbientLight {
  const light = new AmbientLight(0xffffff, 1);
  return light;
}
