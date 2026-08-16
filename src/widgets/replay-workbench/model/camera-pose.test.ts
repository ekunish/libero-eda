import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { ReplayManifest } from "@/shared/api";
import { applyImagePlaneYConvention, fixedCameraPoseFromCalibration } from "./camera-pose";

type SceneCameraCalibration = ReplayManifest["scene_cameras"][number];

const calibration: SceneCameraCalibration = {
  camera: "agentview",
  position: [1, 2, 3],
  rotation_matrix: [0, 1, 0, 0, 0, 1, 1, 0, 0],
  rotation_matrix_layout: "row_major",
  rotation_matrix_convention: "camera_local_to_world",
  camera_axis_convention: "mujoco_camera",
  vertical_fov_degrees: 47,
  scope: "fixed_world",
  calibration_provenance: "asymmetric unit-test fixture",
};

describe("fixed camera pose", () => {
  it("uses MuJoCo camera forward and up axes with a row-major local-to-world rotation", () => {
    const pose = fixedCameraPoseFromCalibration(calibration);
    const rotation = calibration.rotation_matrix;
    const expectedTarget = [
      calibration.position[0] - rotation[2],
      calibration.position[1] - rotation[5],
      calibration.position[2] - rotation[8],
    ];
    const expectedUp = [rotation[1], rotation[4], rotation[7]];

    expect(pose.position).toEqual([1, 2, 3]);
    for (const axis of [0, 1, 2] as const) {
      expect(pose.target[axis]).toBeCloseTo(expectedTarget[axis] ?? 0, 12);
      expect(pose.up[axis]).toBeCloseTo(expectedUp[axis] ?? 0, 12);
    }
    expect(expectedTarget).toEqual([1, 1, 3]);
    expect(expectedUp).toEqual([1, 0, 0]);
    expect(pose.fov).toBe(47);
    expect(pose.imagePlaneY).toBe("down");
    expect(Math.hypot(...pose.quaternion)).toBeCloseTo(1, 12);
  });

  it("flips only the image-plane Y projection", () => {
    const source = new THREE.Matrix4().makePerspective(-1, 1, 1, -1, 0.1, 10);
    const corrected = applyImagePlaneYConvention(source, "down");

    expect(corrected.elements[0]).toBe(source.elements[0]);
    expect(corrected.elements[5]).toBe(-Math.abs(source.elements[5]));
    for (const index of Array.from({ length: 16 }, (_, value) => value).filter(
      (value) => value !== 5,
    )) {
      expect(corrected.elements[index]).toBe(source.elements[index]);
    }
    expect(applyImagePlaneYConvention(corrected, "up").elements[5]).toBe(
      Math.abs(source.elements[5]),
    );
  });
});
