"use client";

import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { type ComponentRef, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  buildGripperTrajectorySegments,
  GRIPPER_TRAJECTORY_STYLES,
  type GripperCommandState,
  type TrajectoryPoint,
} from "../model/gripper-trajectory";
import {
  cumulativeTrajectoryDistances,
  trajectoryVertexRgba,
  writeTrajectorySegmentColors,
} from "../model/trajectory-appearance";

type PreparedTrajectorySegment = {
  state: GripperCommandState;
  startIndex: number;
  points: TrajectoryPoint[];
  cumulativeDistances: number[];
};

function RainbowTrajectorySegment({
  segment,
  frame,
  reducedMotion,
}: {
  segment: PreparedTrajectorySegment;
  frame: number;
  reducedMotion: boolean;
}) {
  const lineRef = useRef<ComponentRef<typeof Line>>(null);
  const initialColors = useMemo(
    () =>
      segment.cumulativeDistances.map((distance, index) =>
        trajectoryVertexRgba(segment.state, distance, segment.startIndex + index, 0, 0),
      ),
    [segment],
  );

  useFrame(({ clock }) => {
    const elapsedSeconds = reducedMotion ? 0 : clock.getElapsedTime();
    const line = lineRef.current;
    if (!line) return;
    const start = line.geometry.getAttribute("instanceColorStart");
    const end = line.geometry.getAttribute("instanceColorEnd");
    if (
      !(start instanceof THREE.InterleavedBufferAttribute) ||
      !(end instanceof THREE.InterleavedBufferAttribute) ||
      start.data !== end.data ||
      !(start.data.array instanceof Float32Array)
    ) {
      throw new Error("Rainbow trajectory requires one shared RGBA interleaved color buffer.");
    }
    writeTrajectorySegmentColors(
      start.data.array,
      segment.state,
      segment.cumulativeDistances,
      segment.startIndex,
      frame,
      elapsedSeconds,
    );
    start.data.needsUpdate = true;
  });

  return (
    <Line
      ref={lineRef}
      points={segment.points}
      vertexColors={initialColors}
      lineWidth={GRIPPER_TRAJECTORY_STYLES[segment.state].lineWidth}
      depthWrite={false}
      alphaToCoverage
      renderOrder={10}
    />
  );
}

function CurrentTrajectoryMarker({
  position,
  state,
  cumulativeDistance,
  reducedMotion,
}: {
  position: TrajectoryPoint;
  state: GripperCommandState;
  cumulativeDistance: number;
  reducedMotion: boolean;
}) {
  const billboardRef = useRef<THREE.Group>(null);
  const coreMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const ringMaterialRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(({ camera, clock }) => {
    billboardRef.current?.quaternion.copy(camera.quaternion);
    const elapsedSeconds = reducedMotion ? 0 : clock.getElapsedTime();
    const [red, green, blue] = trajectoryVertexRgba(
      state,
      cumulativeDistance,
      0,
      0,
      elapsedSeconds,
    );
    coreMaterialRef.current?.color.setRGB(red, green, blue);
    ringMaterialRef.current?.color.setRGB(red, green, blue);
  });

  const color = useMemo(() => {
    const initialColor = trajectoryVertexRgba(state, cumulativeDistance, 0, 0, 0);
    return new THREE.Color(initialColor[0], initialColor[1], initialColor[2]);
  }, [cumulativeDistance, state]);
  return (
    <group ref={billboardRef} position={position} name="current-eef-marker">
      <mesh renderOrder={20}>
        <sphereGeometry args={[0.0042, 16, 16]} />
        <meshBasicMaterial ref={coreMaterialRef} color={color} depthWrite={false} />
      </mesh>
      <mesh renderOrder={20}>
        <ringGeometry args={[0.0072, 0.009, 32]} />
        <meshBasicMaterial
          ref={ringMaterialRef}
          color={color}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

export function AnimatedRainbowTrajectory({
  positions,
  actions,
  frame,
  reducedMotion,
}: {
  positions: number[][];
  actions: number[][];
  frame: number;
  reducedMotion: boolean;
}) {
  const prepared = useMemo(() => {
    const distances = cumulativeTrajectoryDistances(positions);
    return {
      distances,
      segments: buildGripperTrajectorySegments(positions, actions).map(
        (segment): PreparedTrajectorySegment => ({
          state: segment.state,
          startIndex: segment.startIndex,
          points: segment.points,
          cumulativeDistances: distances.slice(segment.startIndex, segment.endIndex + 1),
        }),
      ),
    };
  }, [actions, positions]);

  const currentIndex = Math.min(Math.max(frame, 0), Math.max(positions.length - 1, 0));
  const currentPosition = positions[currentIndex] as TrajectoryPoint | undefined;
  const currentSegment =
    prepared.segments.find(
      (segment) =>
        currentIndex >= segment.startIndex &&
        currentIndex < segment.startIndex + segment.points.length - 1,
    ) ?? prepared.segments.at(-1);
  const currentDistance = prepared.distances[currentIndex] ?? 0;

  return (
    <>
      {prepared.segments.map((segment) => (
        <RainbowTrajectorySegment
          key={`${segment.state}-${segment.startIndex}`}
          segment={segment}
          frame={frame}
          reducedMotion={reducedMotion}
        />
      ))}
      {currentPosition && currentSegment ? (
        <CurrentTrajectoryMarker
          position={currentPosition}
          state={currentSegment.state}
          cumulativeDistance={currentDistance}
          reducedMotion={reducedMotion}
        />
      ) : null}
    </>
  );
}
