import { Suspense } from "react";
import { DataExplorerPage } from "@/_pages/data-explorer";
import { createPageMetadata } from "@/shared/config";

export const metadata = createPageMetadata({
  title: "Recorded Data",
  description:
    "Browse Original LIBERO demonstrations and LIBERO-Plus training trajectories by source task.",
  path: "/data/",
});

export default function DataPage() {
  return (
    <Suspense fallback={<div className="skeleton h-[70vh] w-full" />}>
      <DataExplorerPage />
    </Suspense>
  );
}
