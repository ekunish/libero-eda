import { Suspense } from "react";
import { EvaluationPage } from "@/_pages/evaluation";

export default function Page() {
  return (
    <Suspense fallback={<div className="skeleton h-[70vh] w-full" />}>
      <EvaluationPage />
    </Suspense>
  );
}
