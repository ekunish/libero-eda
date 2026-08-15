import { beforeEach, describe, expect, it } from "vitest";
import { usePlayback } from "./use-playback";

describe("synchronized playback store", () => {
  beforeEach(() => {
    usePlayback.getState().setLoop(true);
    usePlayback.getState().setSpeed(1);
    usePlayback.getState().reset();
  });

  it("loops by default", () => {
    expect(usePlayback.getState().loop).toBe(true);
  });

  it("clamps and rounds a shared playhead", () => {
    usePlayback.getState().configure(100, 20);
    usePlayback.getState().setFrame(12.6);
    expect(usePlayback.getState().frame).toBe(13);
    usePlayback.getState().setFrame(1000);
    expect(usePlayback.getState().frame).toBe(100);
    usePlayback.getState().setFrame(-8);
    expect(usePlayback.getState().frame).toBe(0);
  });

  it("steps every view through the same frame", () => {
    usePlayback.getState().configure(10, 20);
    usePlayback.getState().step(4);
    expect(usePlayback.getState().frame).toBe(4);
    usePlayback.getState().step(-9);
    expect(usePlayback.getState().frame).toBe(0);
  });

  it("resets playback while retaining user speed and loop preferences", () => {
    usePlayback.getState().configure(30, 20);
    usePlayback.getState().setSpeed(0.5);
    usePlayback.getState().setLoop(true);
    usePlayback.getState().setPlaying(true);
    usePlayback.getState().reset();
    expect(usePlayback.getState()).toMatchObject({
      frame: 0,
      playing: false,
      speed: 0.5,
      loop: true,
    });
  });

  it("restarts at frame zero when play is pressed at the end", () => {
    usePlayback.getState().configure(30, 20);
    usePlayback.getState().setLoop(false);
    usePlayback.getState().setFrame(30);
    usePlayback.getState().togglePlaying();
    expect(usePlayback.getState()).toMatchObject({ frame: 0, playing: true });
  });

  it("uses the same toggle action to pause", () => {
    usePlayback.getState().configure(30, 20);
    usePlayback.getState().setPlaying(true);
    usePlayback.getState().togglePlaying();
    expect(usePlayback.getState().playing).toBe(false);
  });
});
