import * as THREE from "three";

export type ManipulatedCueMaterial = {
  material: THREE.MeshPhongMaterial;
  baseEmissive: THREE.Color;
  baseIntensity: number;
};

const manipulatedCueColor = new THREE.Color(0xffb15c);

export function updateManipulatedTaskCue(
  binding: ManipulatedCueMaterial,
  enabled: boolean,
  phase: number,
): void {
  if (!enabled) {
    binding.material.emissive.copy(binding.baseEmissive);
    binding.material.emissiveIntensity = binding.baseIntensity;
    return;
  }
  binding.material.emissive.copy(binding.baseEmissive).lerp(manipulatedCueColor, 0.58);
  binding.material.emissiveIntensity =
    binding.baseIntensity + 0.08 + THREE.MathUtils.clamp(phase, 0, 1) * 0.14;
}

export function createDestinationTaskCueOutline(mesh: THREE.Mesh): THREE.LineSegments {
  const geometry = new THREE.EdgesGeometry(mesh.geometry, 35);
  const material = new THREE.LineBasicMaterial({
    color: 0x62dce9,
    transparent: true,
    opacity: 0.58,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  const outline = new THREE.LineSegments(geometry, material);
  outline.name = `${mesh.name}__task_destination_outline`;
  outline.renderOrder = 11;
  outline.userData.parcTaskCueOutline = true;
  return outline;
}

export function disposeTaskCueOutline(outline: THREE.LineSegments): void {
  outline.geometry.dispose();
  const materials = Array.isArray(outline.material) ? outline.material : [outline.material];
  for (const material of materials) material.dispose();
}

export function setTaskCueOutlinesVisible(
  outlines: readonly THREE.LineSegments[],
  visible: boolean,
): void {
  for (const outline of outlines) outline.visible = visible;
}
