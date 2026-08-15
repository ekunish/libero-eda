import { Suspense } from "react";
import { DataSourcesPage } from "@/_pages/data-sources";
import { createPageMetadata } from "@/shared/config";

export const metadata = createPageMetadata({
  title: "Data Sources",
  description:
    "Inspect the pinned repositories, dataset structures, revisions, counts, and lineage used by LIBERO EDA.",
  path: "/sources/",
});

export default function Page() {
  return (
    <Suspense fallback={<div className="skeleton h-[70vh] w-full" />}>
      <DataSourcesPage />
    </Suspense>
  );
}
