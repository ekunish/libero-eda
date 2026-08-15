import type { ReplayManifest, ReplayVideo } from "@/shared/api";

export function videoTimeForSeriesFrame(
  manifest: ReplayManifest,
  video: ReplayVideo,
  seriesFrame: number,
): number {
  const videoFrame = Math.max(0, seriesFrame - video.frame_offset);
  return video.start_time_sec + videoFrame / manifest.fps;
}

export function clampVideoTime(time: number, duration: number): number {
  if (!Number.isFinite(time) || time < 0) return 0;
  if (!Number.isFinite(duration) || duration < 0) return time;
  return Math.min(time, duration);
}
