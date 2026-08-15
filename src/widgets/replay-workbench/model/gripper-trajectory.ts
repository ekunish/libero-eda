export type GripperCommandState = "open" | "closed" | "unknown";

export type TrajectoryPoint = [number, number, number];

export type GripperTrajectorySegment = {
  state: GripperCommandState;
  startIndex: number;
  endIndex: number;
  points: TrajectoryPoint[];
};

export const GRIPPER_TRAJECTORY_STYLES = {
  open: {
    label: "Open command",
    color: "#4e8477",
    lineType: "solid",
    lineWidth: 2.2,
  },
  closed: {
    label: "Close command",
    color: "#8a6fa5",
    lineType: "solid",
    lineWidth: 2.8,
  },
  unknown: {
    label: "Unknown",
    color: "#787d78",
    lineType: "solid",
    lineWidth: 2.2,
  },
} as const;

function trajectoryPoint(point: number[] | undefined): TrajectoryPoint {
  return [point?.[0] ?? 0, point?.[1] ?? 0, point?.[2] ?? 0];
}

function gripperCommandState(
  action: number[] | undefined,
  previous: GripperCommandState,
): GripperCommandState {
  const value = action?.[6];
  if (value === undefined || !Number.isFinite(value)) return "unknown";
  if (value < 0) return "open";
  if (value > 0) return "closed";
  return previous;
}

export function buildGripperTrajectorySegments(
  positions: number[][],
  actions: number[][],
): GripperTrajectorySegment[] {
  if (positions.length < 2) return [];
  const segments: GripperTrajectorySegment[] = [];
  let previous: GripperCommandState = "unknown";

  for (let index = 0; index < positions.length - 1; index += 1) {
    const action = actions[index];
    const state = gripperCommandState(action, previous);
    previous = action?.[6] === undefined || !Number.isFinite(action[6]) ? "unknown" : state;
    const end = trajectoryPoint(positions[index + 1]);
    const current = segments.at(-1);
    if (current?.state === state) {
      current.points.push(end);
      current.endIndex = index + 1;
      continue;
    }
    segments.push({
      state,
      startIndex: index,
      endIndex: index + 1,
      points: [trajectoryPoint(positions[index]), end],
    });
  }

  return segments;
}
