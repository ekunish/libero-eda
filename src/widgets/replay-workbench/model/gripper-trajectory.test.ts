import { describe, expect, it } from "vitest";
import { buildGripperTrajectorySegments, GRIPPER_TRAJECTORY_STYLES } from "./gripper-trajectory";

const positions = [
  [0, 0, 0],
  [1, 0, 0],
  [2, 0, 0],
  [3, 0, 0],
  [4, 0, 0],
];

describe("buildGripperTrajectorySegments", () => {
  it("groups open and closed commands without leaving a gap at the boundary", () => {
    const segments = buildGripperTrajectorySegments(positions, [
      [0, 0, 0, 0, 0, 0, -0.2],
      [0, 0, 0, 0, 0, 0, -1],
      [0, 0, 0, 0, 0, 0, 0.4],
      [0, 0, 0, 0, 0, 0, 1],
    ]);

    expect(segments).toEqual([
      {
        state: "open",
        startIndex: 0,
        endIndex: 2,
        points: [positions[0], positions[1], positions[2]],
      },
      {
        state: "closed",
        startIndex: 2,
        endIndex: 4,
        points: [positions[2], positions[3], positions[4]],
      },
    ]);
  });

  it("keeps the previous command for an exact zero action", () => {
    const segments = buildGripperTrajectorySegments(positions.slice(0, 4), [
      [0, 0, 0, 0, 0, 0, 1],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, -1],
    ]);

    expect(segments.map((segment) => segment.state)).toEqual(["closed", "open"]);
    expect(segments[0]?.points).toEqual([positions[0], positions[1], positions[2]]);
  });

  it("marks a leading zero and missing actions as unknown instead of guessing", () => {
    const segments = buildGripperTrajectorySegments(positions, [
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, -1],
    ]);

    expect(segments).toEqual([
      { state: "unknown", startIndex: 0, endIndex: 1, points: [positions[0], positions[1]] },
      { state: "open", startIndex: 1, endIndex: 2, points: [positions[1], positions[2]] },
      {
        state: "unknown",
        startIndex: 2,
        endIndex: 4,
        points: [positions[2], positions[3], positions[4]],
      },
    ]);
  });

  it("ignores a trailing action when states and actions have the same length", () => {
    const segments = buildGripperTrajectorySegments(positions.slice(0, 3), [
      [0, 0, 0, 0, 0, 0, -1],
      [0, 0, 0, 0, 0, 0, 1],
      [0, 0, 0, 0, 0, 0, -1],
    ]);

    expect(
      segments.map(({ state, startIndex, endIndex }) => ({ state, startIndex, endIndex })),
    ).toEqual([
      { state: "open", startIndex: 0, endIndex: 1 },
      { state: "closed", startIndex: 1, endIndex: 2 },
    ]);
  });

  it("uses distinct labels and colors without hard-to-read dashed lines", () => {
    expect(new Set(Object.values(GRIPPER_TRAJECTORY_STYLES).map((style) => style.label)).size).toBe(
      3,
    );
    expect(new Set(Object.values(GRIPPER_TRAJECTORY_STYLES).map((style) => style.color)).size).toBe(
      3,
    );
    expect(Object.values(GRIPPER_TRAJECTORY_STYLES).map((style) => style.lineType)).toEqual([
      "solid",
      "solid",
      "solid",
    ]);
    expect(GRIPPER_TRAJECTORY_STYLES.closed.lineWidth).toBeGreaterThan(
      GRIPPER_TRAJECTORY_STYLES.open.lineWidth,
    );
  });
});
