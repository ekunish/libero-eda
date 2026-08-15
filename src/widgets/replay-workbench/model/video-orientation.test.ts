import { beforeEach, describe, expect, it } from "vitest";
import type { ReplayManifest, ReplayVideo } from "@/shared/api";
import {
  cssVideoTransform,
  defaultVideoTransform,
  orientationPreferenceKey,
  resetVideoTransform,
  resolveVideoOrientation,
  saveVideoTransform,
} from "./video-orientation";

const video: ReplayVideo = {
  camera: "agentview",
  asset_id: "front-video",
  start_time_sec: 0,
  end_time_sec: 1,
  frame_offset: 0,
  width: 256,
  height: 256,
  default_display_transform: "rotate_180",
  display_transform_provenance: "app:test",
};

const manifest = {
  source: "dataset",
  dataset_id: "lerobot_libero_plus",
} as ReplayManifest;

describe("video orientation preferences", () => {
  beforeEach(() => window.localStorage.clear());

  it("turns rotate 180 into two independent display flips", () => {
    expect(defaultVideoTransform(video)).toEqual({ flipHorizontal: true, flipVertical: true });
    expect(cssVideoTransform({ flipHorizontal: true, flipVertical: true })).toBe(
      "scaleX(-1) scaleY(-1)",
    );
  });

  it("persists overrides by dataset namespace and camera", () => {
    saveVideoTransform(manifest, video, { flipHorizontal: false, flipVertical: true });
    expect(resolveVideoOrientation(manifest, video)).toEqual({
      mode: "saved",
      transform: { flipHorizontal: false, flipVertical: true },
      isKnownDefault: true,
    });
    expect(orientationPreferenceKey(manifest, "agentview")).toBe(
      "dataset:lerobot_libero_plus:agentview",
    );

    const wrist = { ...video, camera: "robot0_eye_in_hand" };
    expect(resolveVideoOrientation(manifest, wrist).mode).toBe("default");
    const originalManifest = { ...manifest, dataset_id: "original_libero" } as ReplayManifest;
    const originalVideo = { ...video, default_display_transform: "identity" as const };
    expect(resolveVideoOrientation(originalManifest, originalVideo)).toMatchObject({
      mode: "default",
      transform: { flipHorizontal: false, flipVertical: false },
    });

    resetVideoTransform(manifest, video);
    expect(resolveVideoOrientation(manifest, video).mode).toBe("default");
  });

  it("ignores malformed browser preferences", () => {
    window.localStorage.setItem(
      "libero-eda.video-orientation.v1",
      JSON.stringify({
        [orientationPreferenceKey(manifest, "agentview")]: {
          flipHorizontal: "yes",
          flipVertical: true,
        },
      }),
    );
    expect(resolveVideoOrientation(manifest, video).mode).toBe("default");
  });

  it("keeps an unknown convention explicit and shows raw pixels", () => {
    const unknownVideo = {
      ...video,
      default_display_transform: "unknown" as const,
      display_transform_provenance: "unknown:unrecognized-source-namespace",
    };
    expect(resolveVideoOrientation(manifest, unknownVideo)).toEqual({
      mode: "raw",
      transform: { flipHorizontal: false, flipVertical: false },
      isKnownDefault: false,
    });
  });
});
