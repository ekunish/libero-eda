export const trainingPathTagLabels: Record<string, string> = {
  camera_view: "camera_view / camera views",
  env: "env / environment textures",
  language: "language / instructions",
  light: "light / lighting",
  noise: "noise / image noise",
};

export function formatTrainingPathTag(tag: string | null): string {
  if (!tag) return "No path tag";
  return trainingPathTagLabels[tag] ?? tag;
}
