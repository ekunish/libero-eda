import { Suspense } from "react";
import { ReplayPage } from "@/_pages/replay";

export default function Page() {
  return (
    <Suspense fallback={<div className="skeleton h-[70vh] w-full" />}>
      <ReplayPage />
    </Suspense>
  );
}
