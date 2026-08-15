import { Suspense } from "react";
import { DataExplorerPage } from "@/_pages/data-explorer";

export default function DataPage() {
  return (
    <Suspense fallback={<div className="skeleton h-[70vh] w-full" />}>
      <DataExplorerPage />
    </Suspense>
  );
}
