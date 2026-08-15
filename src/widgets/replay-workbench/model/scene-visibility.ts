import type { ReplayManifest } from "@/shared/api";

const collisionName = /(?:^|_)collision(?:$|_)/i;

export function shouldHideSceneNode(
  sceneSchema: ReplayManifest["scene_schema"],
  nodeName: string,
): boolean {
  return sceneSchema === "legacy-analysis" && collisionName.test(nodeName);
}
