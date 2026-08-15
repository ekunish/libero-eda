import {
  buildGripperTrajectorySegments,
  GRIPPER_TRAJECTORY_STYLES,
  type GripperCommandState,
  type TrajectoryPoint,
} from "./gripper-trajectory";

export const TRAJECTORY_FLOW = {
  spatialPeriodMeters: 0.16,
  cyclesPerSecond: 0.18,
  saturation: 0.88,
  lightness: 0.57,
  pastOpacity: 0.18,
  futureOpacity: 0.68,
  pastTransitionFrames: 8,
  futureTransitionFrames: 6,
} as const;

export type TrajectoryTemporalRegion = "past" | "current" | "future";

export type StaticTrajectorySegment = {
  state: GripperCommandState;
  region: TrajectoryTemporalRegion;
  startIndex: number;
  endIndex: number;
  points: TrajectoryPoint[];
};

export type RgbaTuple = [number, number, number, number];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function interpolate(start: number, end: number, amount: number): number {
  return start + (end - start) * clamp01(amount);
}

function wrapDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function hslToRgb(hueDegrees: number, saturation: number, lightness: number) {
  const hue = wrapDegrees(hueDegrees) / 60;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const intermediate = chroma * (1 - Math.abs((hue % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;
  if (hue < 1) [red, green] = [chroma, intermediate];
  else if (hue < 2) [red, green] = [intermediate, chroma];
  else if (hue < 3) [green, blue] = [chroma, intermediate];
  else if (hue < 4) [green, blue] = [intermediate, chroma];
  else if (hue < 5) [red, blue] = [intermediate, chroma];
  else [red, blue] = [chroma, intermediate];
  const match = lightness - chroma / 2;
  return [red + match, green + match, blue + match] as const;
}

export function cumulativeTrajectoryDistances(positions: number[][]): number[] {
  if (positions.length === 0) return [];
  const distances = [0];
  for (let index = 1; index < positions.length; index += 1) {
    const previous = positions[index - 1];
    const current = positions[index];
    if (
      previous?.length !== 3 ||
      current?.length !== 3 ||
      previous.some((value) => !Number.isFinite(value)) ||
      current.some((value) => !Number.isFinite(value))
    ) {
      throw new Error(`EEF trajectory point ${index} is not a finite XYZ coordinate.`);
    }
    distances.push(
      (distances[index - 1] ?? 0) +
        Math.hypot(
          (current[0] ?? 0) - (previous[0] ?? 0),
          (current[1] ?? 0) - (previous[1] ?? 0),
          (current[2] ?? 0) - (previous[2] ?? 0),
        ),
    );
  }
  return distances;
}

export function trajectoryTemporalOpacity(pointIndex: number, currentFrame: number): number {
  const delta = pointIndex - currentFrame;
  if (delta < 0) {
    return interpolate(
      TRAJECTORY_FLOW.pastOpacity,
      1,
      (delta + TRAJECTORY_FLOW.pastTransitionFrames) / TRAJECTORY_FLOW.pastTransitionFrames,
    );
  }
  if (delta === 0) return 1;
  return interpolate(
    1,
    TRAJECTORY_FLOW.futureOpacity,
    delta / TRAJECTORY_FLOW.futureTransitionFrames,
  );
}

export function trajectoryHueDegrees(
  state: GripperCommandState,
  cumulativeDistance: number,
  elapsedSeconds: number,
): number | null {
  const range = GRIPPER_TRAJECTORY_STYLES[state].hueRange;
  if (!range) return null;
  const wave =
    0.5 +
    0.5 *
      Math.sin(
        Math.PI *
          2 *
          (cumulativeDistance / TRAJECTORY_FLOW.spatialPeriodMeters -
            elapsedSeconds * TRAJECTORY_FLOW.cyclesPerSecond),
      );
  return wrapDegrees(interpolate(range[0], range[1], wave));
}

export function trajectoryVertexRgba(
  state: GripperCommandState,
  cumulativeDistance: number,
  pointIndex: number,
  currentFrame: number,
  elapsedSeconds: number,
): RgbaTuple {
  const hue = trajectoryHueDegrees(state, cumulativeDistance, elapsedSeconds);
  const [red, green, blue] =
    hue === null
      ? GRIPPER_TRAJECTORY_STYLES.unknown.rgb
      : hslToRgb(hue, TRAJECTORY_FLOW.saturation, TRAJECTORY_FLOW.lightness);
  return [red, green, blue, trajectoryTemporalOpacity(pointIndex, currentFrame)];
}

export function writeTrajectorySegmentColors(
  target: Float32Array,
  state: GripperCommandState,
  cumulativeDistances: number[],
  startIndex: number,
  currentFrame: number,
  elapsedSeconds: number,
): void {
  const expectedLength = Math.max(0, cumulativeDistances.length - 1) * 8;
  if (target.length !== expectedLength) {
    throw new Error(
      `Trajectory color buffer length ${target.length} does not match expected ${expectedLength}.`,
    );
  }
  for (let edge = 0; edge < cumulativeDistances.length - 1; edge += 1) {
    const offset = edge * 8;
    const start = trajectoryVertexRgba(
      state,
      cumulativeDistances[edge] ?? 0,
      startIndex + edge,
      currentFrame,
      elapsedSeconds,
    );
    const end = trajectoryVertexRgba(
      state,
      cumulativeDistances[edge + 1] ?? 0,
      startIndex + edge + 1,
      currentFrame,
      elapsedSeconds,
    );
    target.set(start, offset);
    target.set(end, offset + 4);
  }
}

function temporalRegionForEdge(edgeIndex: number, currentFrame: number): TrajectoryTemporalRegion {
  if (edgeIndex + 1 < currentFrame) return "past";
  if (edgeIndex > currentFrame) return "future";
  return "current";
}

export function buildStaticTrajectorySegments(
  positions: number[][],
  actions: number[][],
  currentFrame: number,
): StaticTrajectorySegment[] {
  const result: StaticTrajectorySegment[] = [];
  for (const commandSegment of buildGripperTrajectorySegments(positions, actions)) {
    for (
      let edgeIndex = commandSegment.startIndex;
      edgeIndex < commandSegment.endIndex;
      edgeIndex += 1
    ) {
      const localIndex = edgeIndex - commandSegment.startIndex;
      const start = commandSegment.points[localIndex];
      const end = commandSegment.points[localIndex + 1];
      if (!start || !end) throw new Error(`Trajectory segment ${edgeIndex} is incomplete.`);
      const region = temporalRegionForEdge(edgeIndex, currentFrame);
      const current = result.at(-1);
      if (current?.state === commandSegment.state && current.region === region) {
        current.points.push(end);
        current.endIndex = edgeIndex + 1;
      } else {
        result.push({
          state: commandSegment.state,
          region,
          startIndex: edgeIndex,
          endIndex: edgeIndex + 1,
          points: [start, end],
        });
      }
    }
  }
  return result;
}
