import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  createDestinationTaskCueOutline,
  disposeTaskCueOutline,
  setTaskCueOutlinesVisible,
  updateManipulatedTaskCue,
} from "./task-cue-appearance";

describe("task cue appearance", () => {
  it("changes only emissive properties on a manipulated material and restores them", () => {
    const map = new THREE.Texture();
    const material = new THREE.MeshPhongMaterial({
      color: 0x123456,
      map,
      opacity: 0.73,
      transparent: true,
      emissive: 0x010203,
      emissiveIntensity: 0.12,
    });
    const baseEmissive = material.emissive.clone();
    const baseColor = material.color.clone();

    updateManipulatedTaskCue({ material, baseEmissive, baseIntensity: 0.12 }, true, 1);
    expect(material.emissive.getHex()).not.toBe(baseEmissive.getHex());
    expect(material.emissiveIntensity).toBeCloseTo(0.34);
    expect(material.color.equals(baseColor)).toBe(true);
    expect(material.map).toBe(map);
    expect(material.opacity).toBe(0.73);
    expect(material.transparent).toBe(true);

    updateManipulatedTaskCue({ material, baseEmissive, baseIntensity: 0.12 }, false, 0);
    expect(material.emissive.equals(baseEmissive)).toBe(true);
    expect(material.emissiveIntensity).toBe(0.12);
    material.dispose();
    map.dispose();
  });

  it("creates a static depth-tested destination outline", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    mesh.name = "plate_1_main";
    const outline = createDestinationTaskCueOutline(mesh);
    const material = outline.material as THREE.LineBasicMaterial;
    expect(outline.name).toBe("plate_1_main__task_destination_outline");
    expect(outline.userData.parcTaskCueOutline).toBe(true);
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.opacity).toBe(0.58);
    setTaskCueOutlinesVisible([outline], false);
    expect(outline.visible).toBe(false);
    setTaskCueOutlinesVisible([outline], true);
    expect(outline.visible).toBe(true);
    disposeTaskCueOutline(outline);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });
});
