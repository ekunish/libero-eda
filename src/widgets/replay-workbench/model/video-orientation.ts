import type { ReplayManifest, ReplayVideo } from "@/shared/api";

export type VideoTransform = {
  flipHorizontal: boolean;
  flipVertical: boolean;
};

export type VideoTransformMode = "default" | "saved" | "raw";

export type VideoOrientationState = {
  mode: VideoTransformMode;
  transform: VideoTransform;
  isKnownDefault: boolean;
};

const STORAGE_KEY = "libero-eda.video-orientation.v1";
export const IDENTITY_TRANSFORM: VideoTransform = {
  flipHorizontal: false,
  flipVertical: false,
};

function namespaceOf(manifest: ReplayManifest): string {
  if (manifest.source === "dataset") return `dataset:${manifest.dataset_id ?? "unknown"}`;
  return `source:${manifest.source}`;
}

export function orientationPreferenceKey(manifest: ReplayManifest, camera: string): string {
  return `${namespaceOf(manifest)}:${camera}`;
}

export function defaultVideoTransform(video: ReplayVideo): VideoTransform | null {
  if (video.default_display_transform === "identity") return IDENTITY_TRANSFORM;
  if (video.default_display_transform === "rotate_180") {
    return { flipHorizontal: true, flipVertical: true };
  }
  return null;
}

function readPreferences(): Record<string, VideoTransform> {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) => {
        if (
          !value ||
          typeof value !== "object" ||
          typeof (value as VideoTransform).flipHorizontal !== "boolean" ||
          typeof (value as VideoTransform).flipVertical !== "boolean"
        ) {
          return [];
        }
        return [[key, value as VideoTransform]];
      }),
    );
  } catch {
    return {};
  }
}

export function savedVideoTransform(
  manifest: ReplayManifest,
  video: ReplayVideo,
): VideoTransform | null {
  return readPreferences()[orientationPreferenceKey(manifest, video.camera)] ?? null;
}

export function resolveVideoOrientation(
  manifest: ReplayManifest,
  video: ReplayVideo,
): VideoOrientationState {
  const declared = defaultVideoTransform(video);
  const saved = savedVideoTransform(manifest, video);
  if (saved) return { mode: "saved", transform: saved, isKnownDefault: declared !== null };
  if (declared) return { mode: "default", transform: declared, isKnownDefault: true };
  return { mode: "raw", transform: IDENTITY_TRANSFORM, isKnownDefault: false };
}

export function saveVideoTransform(
  manifest: ReplayManifest,
  video: ReplayVideo,
  transform: VideoTransform,
): void {
  if (typeof window === "undefined") return;
  const preferences = readPreferences();
  preferences[orientationPreferenceKey(manifest, video.camera)] = transform;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

export function resetVideoTransform(manifest: ReplayManifest, video: ReplayVideo): void {
  if (typeof window === "undefined") return;
  const preferences = readPreferences();
  delete preferences[orientationPreferenceKey(manifest, video.camera)];
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

export function cssVideoTransform(transform: VideoTransform): string {
  return `scaleX(${transform.flipHorizontal ? -1 : 1}) scaleY(${transform.flipVertical ? -1 : 1})`;
}
