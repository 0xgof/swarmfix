import {
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Scene
} from "three";
import { describe, expect, it, vi } from "vitest";

import { disposeSceneGraph } from "./disposeScene";

describe("disposeSceneGraph", () => {
  it("disposes nested geometries and materials before clearing a scene", () => {
    const scene = new Scene();
    const group = new Group();
    const geometry = new BufferGeometry();
    const material = new MeshBasicMaterial();
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");

    group.add(new Mesh(geometry, material));
    scene.add(group);

    disposeSceneGraph(scene);

    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(scene.children).toHaveLength(0);
  });

  it("disposes every material in a multi-material object", () => {
    const scene = new Scene();
    const geometry = new BufferGeometry();
    const firstMaterial = new MeshBasicMaterial();
    const secondMaterial = new MeshBasicMaterial();
    const firstMaterialDispose = vi.spyOn(firstMaterial, "dispose");
    const secondMaterialDispose = vi.spyOn(secondMaterial, "dispose");

    scene.add(new Mesh(geometry, [firstMaterial, secondMaterial]));

    disposeSceneGraph(scene);

    expect(firstMaterialDispose).toHaveBeenCalledTimes(1);
    expect(secondMaterialDispose).toHaveBeenCalledTimes(1);
  });
});
