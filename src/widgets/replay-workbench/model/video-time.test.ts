import { describe, expect, it } from "vitest";
import type { ReplayManifest, ReplayVideo } from "@/shared/api";
import { clampVideoTime, videoTimeForSeriesFrame } from "./video-time";

const manifest = { fps: 20 } as ReplayManifest;
const video = { start_time_sec: 0, frame_offset: 0 } as ReplayVideo;

describe("videoTimeForSeriesFrame", () => {
  it("keeps aligned v2 frames on the same timebase", () => {
    expect(videoTimeForSeriesFrame(manifest, video, 3)).toBe(0.15);
  });

  it("maps legacy series frame zero to the leading-video frame after initial state", () => {
    expect(videoTimeForSeriesFrame(manifest, { ...video, frame_offset: -1 }, 0)).toBe(0.05);
  });

  it("clamps a delayed video before its first represented series frame", () => {
    expect(videoTimeForSeriesFrame(manifest, { ...video, frame_offset: 2 }, 1)).toBe(0);
  });
});

describe("clampVideoTime", () => {
  it("keeps requested time inside the decoded media duration", () => {
    expect(clampVideoTime(806.8, 5.65)).toBe(5.65);
    expect(clampVideoTime(0.25, 5.65)).toBe(0.25);
  });

  it("rejects invalid negative or non-finite requested times", () => {
    expect(clampVideoTime(-1, 5.65)).toBe(0);
    expect(clampVideoTime(Number.NaN, 5.65)).toBe(0);
  });
});
