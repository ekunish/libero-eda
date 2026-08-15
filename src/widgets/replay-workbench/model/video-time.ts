import type { ReplayManifest, ReplayVideo } from "@/shared/api";

export function videoTimeForSeriesFrame(
  manifest: ReplayManifest,
  video: ReplayVideo,
  seriesFrame: number,
): number {
  const videoFrame = Math.max(0, seriesFrame - video.frame_offset);
  return video.start_time_sec + videoFrame / manifest.fps;
}
