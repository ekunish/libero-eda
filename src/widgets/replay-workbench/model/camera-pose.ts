import * as THREE from "three";
import type { ReplayManifest } from "@/shared/api";

type Vector3Tuple = [number, number, number];
type QuaternionTuple = [number, number, number, number];
type SceneCameraCalibration = ReplayManifest["scene_cameras"][number];

export type FixedCameraPose = {
  position: Vector3Tuple;
  quaternion: QuaternionTuple;
  target: Vector3Tuple;
  up: Vector3Tuple;
  fov: number;
  imagePlaneY: "up" | "down";
};

export function applyImagePlaneYConvention(
  projection: THREE.Matrix4,
  convention: FixedCameraPose["imagePlaneY"],
): THREE.Matrix4 {
  const result = projection.clone();
  result.elements[5] =
    convention === "down" ? -Math.abs(result.elements[5]) : Math.abs(result.elements[5]);
  return result;
}

function vector3Tuple(vector: THREE.Vector3): Vector3Tuple {
  return [vector.x, vector.y, vector.z];
}

export function fixedCameraPoseFromCalibration(
  calibration: SceneCameraCalibration,
): FixedCameraPose {
  const rotation = calibration.rotation_matrix;
  const rotationMatrix = new THREE.Matrix4().set(
    rotation[0],
    rotation[1],
    rotation[2],
    0,
    rotation[3],
    rotation[4],
    rotation[5],
    0,
    rotation[6],
    rotation[7],
    rotation[8],
    0,
    0,
    0,
    0,
    1,
  );
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(rotationMatrix).normalize();
  const position = new THREE.Vector3(...calibration.position);
  const target = position.clone().add(new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion));
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);

  return {
    position: vector3Tuple(position),
    quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
    target: vector3Tuple(target),
    up: vector3Tuple(up),
    fov: calibration.vertical_fov_degrees,
    // MuJoCo camera images use a top-left image origin. Three.js uses an
    // upward clip-space Y axis, so the fixed-camera projection must invert Y
    // without rolling the camera (which would also reverse left and right).
    imagePlaneY: "down",
  };
}
