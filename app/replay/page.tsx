import { Suspense } from "react";
import { ReplayPage } from "@/_pages/replay";
import { createPageMetadata } from "@/shared/config";

export const metadata = createPageMetadata({
  title: "Replay Studio",
  description:
    "Replay synchronized camera video, robot scenes, end-effector trajectories, and action channels.",
  path: "/replay/",
});

export default function Page() {
  return (
    <Suspense fallback={<div className="eda-skeleton h-[70vh] w-full" />}>
      <ReplayPage />
    </Suspense>
  );
}
