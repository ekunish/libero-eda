import { describe, expect, it } from "vitest";
import { shouldHideSceneNode } from "./scene-visibility";

describe("shouldHideSceneNode", () => {
  it.each([
    "robot0_link0_collision",
    "robot0_link1_collision",
    "robot0_link2_collision",
    "robot0_link3_collision",
    "robot0_link4_collision",
    "robot0_link5_collision",
    "robot0_link6_collision",
    "robot0_link7_collision",
    "table_collision",
    "gripper0_hand_collision",
    "gripper0_finger1_collision",
    "gripper0_finger1_pad_collision",
    "gripper0_finger2_collision",
    "gripper0_finger2_pad_collision",
  ])("hides an explicitly named legacy collision node: %s", (name) => {
    expect(shouldHideSceneNode("legacy-analysis", name)).toBe(true);
  });

  it.each([
    "robot0_g0_vis",
    "gripper0_hand_visual",
    "gripper0_finger1_visual",
    "akita_black_bowl_1_g0",
  ])("keeps a legacy visual node: %s", (name) => {
    expect(shouldHideSceneNode("legacy-analysis", name)).toBe(false);
  });

  it("does not reinterpret scene v3 nodes", () => {
    expect(shouldHideSceneNode("parc-mujoco-scene/v3", "unexpected_collision")).toBe(false);
  });
});
