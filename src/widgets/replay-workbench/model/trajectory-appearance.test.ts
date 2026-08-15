import { describe, expect, it } from "vitest";
import {
  buildStaticTrajectorySegments,
  cumulativeTrajectoryDistances,
  TRAJECTORY_FLOW,
  trajectoryHueDegrees,
  trajectoryTemporalOpacity,
  trajectoryVertexRgba,
  writeTrajectorySegmentColors,
} from "./trajectory-appearance";

describe("trajectory appearance", () => {
  it("uses cumulative spatial distance instead of sample index", () => {
    expect(
      cumulativeTrajectoryDistances([
        [0, 0, 0],
        [0.03, 0.04, 0],
        [0.03, 0.04, 0.12],
      ]),
    ).toEqual([0, 0.05, 0.16999999999999998]);
    expect(() =>
      cumulativeTrajectoryDistances([
        [0, 0, 0],
        [Number.NaN, 0, 0],
      ]),
    ).toThrow(/finite XYZ/);
  });

  it("moves open commands through the full rainbow and closed commands through warm hues", () => {
    const hueDistance = (left: number, right: number) => {
      const delta = Math.abs(left - right);
      return Math.min(delta, 360 - delta);
    };
    const openSamples = [0, 0.04, 0.08, 0.12].map(
      (distance) => trajectoryHueDegrees("open", distance, 0) ?? 0,
    );
    expect(openSamples).toEqual([0, 90, 180, 270]);
    const openLater = trajectoryHueDegrees("open", 0, 0.75) ?? 0;
    expect(hueDistance(openSamples[0] ?? 0, openLater)).toBeGreaterThanOrEqual(90);

    const closedAtStart = trajectoryHueDegrees("closed", 0, 0) ?? 0;
    const closedLater = trajectoryHueDegrees("closed", 0, 0.75) ?? 0;
    expect([closedAtStart, closedLater].every((hue) => hue >= 315 || hue <= 20)).toBe(true);
    expect(hueDistance(closedAtStart, closedLater)).toBeGreaterThanOrEqual(15);
    expect(trajectoryHueDegrees("unknown", 0, 0)).toBeNull();
  });

  it("fades passed points, highlights the current point, and keeps the route ahead visible", () => {
    expect(trajectoryTemporalOpacity(0, 20)).toBe(TRAJECTORY_FLOW.pastOpacity);
    expect(trajectoryTemporalOpacity(19, 20)).toBeGreaterThan(TRAJECTORY_FLOW.pastOpacity);
    expect(trajectoryTemporalOpacity(20, 20)).toBe(1);
    expect(trajectoryTemporalOpacity(26, 20)).toBe(TRAJECTORY_FLOW.futureOpacity);
    expect(trajectoryTemporalOpacity(80, 20)).toBe(TRAJECTORY_FLOW.futureOpacity);
  });

  it("writes paired RGBA colors into the existing line buffer", () => {
    const target = new Float32Array(16);
    writeTrajectorySegmentColors(target, "open", [0, 0.08, 0.16], 10, 11, 0);
    expect(Array.from(target).every(Number.isFinite)).toBe(true);
    expect(target[3]).toBeLessThan(target[7] ?? 0);
    expect(target[7]).toBe(target[11]);
    const halo = new Float32Array(16);
    writeTrajectorySegmentColors(
      halo,
      "open",
      [0, 0.08, 0.16],
      10,
      11,
      0,
      TRAJECTORY_FLOW.haloOpacityScale,
    );
    expect(halo[7]).toBeCloseTo((target[7] ?? 0) * TRAJECTORY_FLOW.haloOpacityScale);
    expect(() =>
      writeTrajectorySegmentColors(new Float32Array(4), "open", [0, 0.08], 0, 0, 0),
    ).toThrow(/buffer length/);
  });

  it("splits the static projection at passage and command boundaries without gaps", () => {
    const positions = [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
      [4, 0, 0],
    ];
    const segments = buildStaticTrajectorySegments(
      positions,
      [
        [0, 0, 0, 0, 0, 0, -1],
        [0, 0, 0, 0, 0, 0, -1],
        [0, 0, 0, 0, 0, 0, 1],
        [0, 0, 0, 0, 0, 0, 1],
      ],
      2,
    );
    expect(
      segments.map(({ state, region, startIndex, endIndex }) => ({
        state,
        region,
        startIndex,
        endIndex,
      })),
    ).toEqual([
      { state: "open", region: "past", startIndex: 0, endIndex: 1 },
      { state: "open", region: "current", startIndex: 1, endIndex: 2 },
      { state: "closed", region: "current", startIndex: 2, endIndex: 3 },
      { state: "closed", region: "future", startIndex: 3, endIndex: 4 },
    ]);
    expect(segments[0]?.points.at(-1)).toEqual(segments[1]?.points[0]);
    expect(segments[0]?.color).not.toBe(segments[1]?.color);
    expect(trajectoryVertexRgba("unknown", 0, 0, 0, 1).slice(0, 3)).toEqual([0.48, 0.52, 0.5]);
  });
});
