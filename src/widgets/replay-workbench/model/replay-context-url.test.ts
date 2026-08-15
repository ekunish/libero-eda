import { describe, expect, it } from "vitest";
import {
  replayContextPath,
  replayHref,
  safeReplayReturnPath,
  sanitizeReplayParams,
} from "./replay-context-url";

describe("Replay context URL", () => {
  it("keeps only filters supported by a LIBERO-Plus dataset replay", () => {
    const sanitized = sanitizeReplayParams(
      new URLSearchParams(
        "replay_scope=run&replay_q=%20mug%20&replay_series=camera_view&replay_outcome=success&replay_offset=51",
      ),
      { source: "dataset", dataset_id: "lerobot_libero_plus" },
    );

    expect(Object.fromEntries(sanitized)).toEqual({
      replay_scope: "task",
      replay_q: "mug",
      replay_series: "camera_view",
      replay_offset: "50",
    });
    expect(replayContextPath("demo/35", sanitized)).toBe(
      "/replays/demo%2F35/context?scope=task&limit=50&q=mug&training_environment_category=camera_view&offset=50",
    );
  });

  it("removes Plus and model-only filters from an Original dataset replay", () => {
    const sanitized = sanitizeReplayParams(
      new URLSearchParams(
        "replay_scope=dataset&replay_series=noise&replay_outcome=failure&replay_offset=bad",
      ),
      { source: "dataset", dataset_id: "original_libero" },
    );

    expect(sanitized.toString()).toBe("replay_scope=dataset");
  });

  it("canonicalizes model runs and preserves a valid outcome filter", () => {
    const sanitized = sanitizeReplayParams(
      new URLSearchParams(
        "replay_scope=task&replay_series=language&replay_outcome=success&replay_offset=100",
      ),
      { source: "rollout", dataset_id: null },
    );

    expect(Object.fromEntries(sanitized)).toEqual({
      replay_scope: "run",
      replay_outcome: "success",
      replay_offset: "100",
    });
    expect(replayHref("run replay", sanitized, true)).toBe(
      "/replay?replay_scope=run&replay_outcome=success&replay_id=run+replay",
    );
  });

  it("accepts only known local workspaces as replay return targets", () => {
    expect(safeReplayReturnPath("/data?dataset=original_libero&task=libero%3A1")).toBe(
      "/data?dataset=original_libero&task=libero%3A1",
    );
    expect(safeReplayReturnPath("/jobs?job=job-1")).toBeNull();
    expect(safeReplayReturnPath("https://example.com/data")).toBeNull();
    expect(safeReplayReturnPath("//example.com/data")).toBeNull();
    expect(safeReplayReturnPath("/replay/other")).toBeNull();
  });
});
