import { describe, expect, it } from "vitest";
import {
  EVALUATION_CATEGORIES,
  evaluationCategorySchema,
  isEvaluationCategory,
} from "./evaluation-category";

describe("official LIBERO-Plus evaluation categories", () => {
  it("preserves the seven exact task_classification.json labels", () => {
    expect(EVALUATION_CATEGORIES).toEqual([
      "Background Textures",
      "Camera Viewpoints",
      "Robot Initial States",
      "Language Instructions",
      "Light Conditions",
      "Objects Layout",
      "Sensor Noise",
    ]);
  });

  it.each(EVALUATION_CATEGORIES)("accepts %s", (category) => {
    expect(evaluationCategorySchema.parse(category)).toBe(category);
    expect(isEvaluationCategory(category)).toBe(true);
  });

  it.each(["Background", "Lighting Conditions", "Object Layouts", "Robot init"])(
    "rejects the non-source label %s",
    (category) => {
      expect(evaluationCategorySchema.safeParse(category).success).toBe(false);
      expect(isEvaluationCategory(category)).toBe(false);
    },
  );
});
