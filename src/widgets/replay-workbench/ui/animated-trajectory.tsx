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
  TRAJECTORY_FLOW,
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
  const haloRef = useRef<ComponentRef<typeof Line>>(null);
  const coreRef = useRef<ComponentRef<typeof Line>>(null);
  const initialCoreColors = useMemo(
    () =>
      segment.cumulativeDistances.map((distance, index) =>
        trajectoryVertexRgba(segment.state, distance, segment.startIndex + index, 0, 0),
      ),
    [segment],
  );
  const initialHaloColors = useMemo(
    () =>
      segment.cumulativeDistances.map((distance, index) =>
        trajectoryVertexRgba(
          segment.state,
          distance,
          segment.startIndex + index,
          0,
          0,
          TRAJECTORY_FLOW.haloOpacityScale,
        ),
      ),
    [segment],
  );

  useFrame(({ clock }) => {
    const elapsedSeconds = reducedMotion ? 0 : clock.getElapsedTime();
    for (const [line, opacityScale] of [
      [haloRef.current, TRAJECTORY_FLOW.haloOpacityScale],
      [coreRef.current, 1],
    ] as const) {
      if (!line) continue;
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
        opacityScale,
      );
      start.data.needsUpdate = true;
    }
  });

  return (
    <>
      <Line
        ref={haloRef}
        points={segment.points}
        vertexColors={initialHaloColors}
        lineWidth={
          GRIPPER_TRAJECTORY_STYLES[segment.state].lineWidth + TRAJECTORY_FLOW.haloWidthAddition
        }
        depthWrite={false}
        alphaToCoverage
        renderOrder={9}
      />
      <Line
        ref={coreRef}
        points={segment.points}
        vertexColors={initialCoreColors}
        lineWidth={GRIPPER_TRAJECTORY_STYLES[segment.state].lineWidth}
        depthWrite={false}
        alphaToCoverage
        renderOrder={10}
      />
    </>
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
  const segments = useMemo(() => {
    const distances = cumulativeTrajectoryDistances(positions);
    return buildGripperTrajectorySegments(positions, actions).map(
      (segment): PreparedTrajectorySegment => ({
        state: segment.state,
        startIndex: segment.startIndex,
        points: segment.points,
        cumulativeDistances: distances.slice(segment.startIndex, segment.endIndex + 1),
      }),
    );
  }, [actions, positions]);

  return segments.map((segment) => (
    <RainbowTrajectorySegment
      key={`${segment.state}-${segment.startIndex}`}
      segment={segment}
      frame={frame}
      reducedMotion={reducedMotion}
    />
  ));
}
