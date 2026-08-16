"use client";

import { PerspectiveCamera, type PerspectiveCameraProps } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useCallback, useLayoutEffect, useRef } from "react";
import type * as THREE from "three";
import { applyImagePlaneYConvention, type FixedCameraPose } from "../model/camera-pose";

export function SourcePerspectiveCamera({
  imagePlaneY,
  ...props
}: PerspectiveCameraProps & { imagePlaneY: FixedCameraPose["imagePlaneY"] }) {
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);

  const applyConvention = useCallback(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    camera.projectionMatrix.copy(applyImagePlaneYConvention(camera.projectionMatrix, imagePlaneY));
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }, [imagePlaneY]);

  useLayoutEffect(applyConvention, [applyConvention]);
  useFrame(() => {
    const y = cameraRef.current?.projectionMatrix.elements[5];
    if (y == null || (imagePlaneY === "down" ? y < 0 : y > 0)) return;
    applyConvention();
  });

  return <PerspectiveCamera ref={cameraRef} {...props} />;
}
