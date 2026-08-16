import { z } from "zod";

export const EVALUATION_CATEGORIES = [
  "Background Textures",
  "Camera Viewpoints",
  "Robot Initial States",
  "Language Instructions",
  "Light Conditions",
  "Objects Layout",
  "Sensor Noise",
] as const;

export type EvaluationCategory = (typeof EVALUATION_CATEGORIES)[number];

export const evaluationCategorySchema = z.enum(EVALUATION_CATEGORIES);

const evaluationCategorySet: ReadonlySet<string> = new Set(EVALUATION_CATEGORIES);

export function isEvaluationCategory(value: string | null): value is EvaluationCategory {
  return value != null && evaluationCategorySet.has(value);
}
