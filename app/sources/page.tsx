import { Suspense } from "react";
import { DataSourcesPage } from "@/_pages/data-sources";

export default function Page() {
  return (
    <Suspense fallback={<div className="skeleton h-[70vh] w-full" />}>
      <DataSourcesPage />
    </Suspense>
  );
}
