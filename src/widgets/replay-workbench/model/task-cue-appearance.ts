import * as THREE from "three";
import type { TaskCueRole } from "./task-cues";

export type TaskCueAppearanceRole = "manipulated" | "destination" | "both";

export type TaskCueMaterial = {
  material: THREE.MeshPhongMaterial;
  baseEmissive: THREE.Color;
  baseIntensity: number;
  role: TaskCueAppearanceRole;
};

export const TASK_CUE_PULSE_PERIOD_SECONDS = 2.5;

const taskCueColors: Record<TaskCueAppearanceRole, THREE.Color> = {
  manipulated: new THREE.Color(0xffb15c),
  destination: new THREE.Color(0x62dce9),
  both: new THREE.Color(0xffffff),
};

export function taskCueAppearanceRole(roles: ReadonlySet<TaskCueRole>): TaskCueAppearanceRole {
  if (roles.has("manipulated") && roles.has("destination")) return "both";
  return roles.has("destination") ? "destination" : "manipulated";
}

export function createTaskCueMaterialBindings(
  materials: readonly THREE.MeshPhongMaterial[],
  roles: ReadonlySet<TaskCueRole>,
): TaskCueMaterial[] {
  const role = taskCueAppearanceRole(roles);
  return materials.map((material) => ({
    material,
    baseEmissive: material.emissive.clone(),
    baseIntensity: material.emissiveIntensity,
    role,
  }));
}

export function taskCuePulsePhase(elapsedSeconds: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0.5;
  return Math.sin((elapsedSeconds / TASK_CUE_PULSE_PERIOD_SECONDS) * Math.PI * 2) / 2 + 0.5;
}

export function updateTaskCueMaterial(
  binding: TaskCueMaterial,
  enabled: boolean,
  phase: number,
): void {
  if (!enabled) {
    binding.material.emissive.copy(binding.baseEmissive);
    binding.material.emissiveIntensity = binding.baseIntensity;
    return;
  }
  binding.material.emissive.copy(binding.baseEmissive).lerp(taskCueColors[binding.role], 0.58);
  binding.material.emissiveIntensity =
    binding.baseIntensity + 0.08 + THREE.MathUtils.clamp(phase, 0, 1) * 0.14;
}
