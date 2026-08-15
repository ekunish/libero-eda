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
    color: "#2fb8d3",
    gradient: [
      "hsl(0 88% 57%)",
      "hsl(60 88% 57%)",
      "hsl(120 88% 57%)",
      "hsl(180 88% 57%)",
      "hsl(240 88% 57%)",
      "hsl(300 88% 57%)",
      "hsl(360 88% 57%)",
    ],
    hueRange: [0, 360] as const,
    rgb: [0.16, 0.78, 0.67] as const,
    lineType: "solid",
    lineWidth: 2.8,
  },
  closed: {
    label: "Close command",
    color: "#ef5a75",
    gradient: ["hsl(315 88% 57%)", "hsl(20 88% 57%)"],
    hueRange: [315, 380] as const,
    rgb: [0.94, 0.35, 0.46] as const,
    lineType: "solid",
    lineWidth: 3.2,
  },
  unknown: {
    label: "Unknown",
    color: "#787d78",
    gradient: ["#787d78", "#a0a6a0"],
    hueRange: null,
    rgb: [0.48, 0.52, 0.5] as const,
    lineType: "solid",
    lineWidth: 2.6,
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
