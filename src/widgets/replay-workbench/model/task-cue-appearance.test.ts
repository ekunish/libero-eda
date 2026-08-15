import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  createTaskCueMaterialBindings,
  TASK_CUE_PULSE_PERIOD_SECONDS,
  type TaskCueAppearanceRole,
  taskCueAppearanceRole,
  taskCuePulsePhase,
  updateTaskCueMaterial,
} from "./task-cue-appearance";

describe("task cue appearance", () => {
  it.each([
    ["manipulated", 0xffb15c],
    ["destination", 0x62dce9],
    ["both", 0xffffff],
  ] satisfies Array<[TaskCueAppearanceRole, number]>)(
    "uses the %s surface-emission color without changing the recorded material",
    (role, expectedColor) => {
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

      updateTaskCueMaterial({ material, baseEmissive, baseIntensity: 0.12, role }, true, 1);
      expect(material.emissive.getHex()).toBe(
        baseEmissive.clone().lerp(new THREE.Color(expectedColor), 0.58).getHex(),
      );
      expect(material.emissiveIntensity).toBeCloseTo(0.34);
      expect(material.color.equals(baseColor)).toBe(true);
      expect(material.map).toBe(map);
      expect(material.opacity).toBe(0.73);
      expect(material.transparent).toBe(true);

      updateTaskCueMaterial({ material, baseEmissive, baseIntensity: 0.12, role }, false, 0);
      expect(material.emissive.equals(baseEmissive)).toBe(true);
      expect(material.emissiveIntensity).toBe(0.12);
      material.dispose();
      map.dispose();
    },
  );

  it("maps manipulated, destination, and dual-role bodies to distinct surface colors", () => {
    expect(taskCueAppearanceRole(new Set(["manipulated"]))).toBe("manipulated");
    expect(taskCueAppearanceRole(new Set(["destination"]))).toBe("destination");
    expect(taskCueAppearanceRole(new Set(["manipulated", "destination"]))).toBe("both");
  });

  it("binds every material on a multi-material task body", () => {
    const first = new THREE.MeshPhongMaterial({ emissive: 0x010203, emissiveIntensity: 0.1 });
    const second = new THREE.MeshPhongMaterial({ emissive: 0x040506, emissiveIntensity: 0.2 });
    const bindings = createTaskCueMaterialBindings(
      [first, second],
      new Set(["manipulated", "destination"]),
    );

    expect(bindings).toHaveLength(2);
    expect(bindings.map(({ role }) => role)).toEqual(["both", "both"]);
    expect(bindings[0]?.baseEmissive.getHex()).toBe(0x010203);
    expect(bindings[1]?.baseIntensity).toBe(0.2);

    first.dispose();
    second.dispose();
  });

  it("completes one synchronized pulse every 2.5 seconds", () => {
    expect(TASK_CUE_PULSE_PERIOD_SECONDS).toBe(2.5);
    expect(taskCuePulsePhase(0, false)).toBeCloseTo(0.5);
    expect(taskCuePulsePhase(0.625, false)).toBeCloseTo(1);
    expect(taskCuePulsePhase(1.25, false)).toBeCloseTo(0.5);
    expect(taskCuePulsePhase(1.875, false)).toBeCloseTo(0);
    expect(taskCuePulsePhase(2.5, false)).toBeCloseTo(0.5);
  });

  it("holds the pulse at its midpoint when reduced motion is enabled", () => {
    expect(taskCuePulsePhase(0, true)).toBe(0.5);
    expect(taskCuePulsePhase(100, true)).toBe(0.5);
  });
});
