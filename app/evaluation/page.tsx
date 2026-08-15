import { Suspense } from "react";
import { EvaluationPage } from "@/_pages/evaluation";
import { createPageMetadata } from "@/shared/config";

export const metadata = createPageMetadata({
  title: "Evaluation Conditions",
  description:
    "Explore 10,030 LIBERO-Plus evaluation conditions across seven published categories and difficulty levels.",
  path: "/evaluation/",
});

export default function Page() {
  return (
    <Suspense fallback={<div className="eda-skeleton h-[70vh] w-full" />}>
      <EvaluationPage />
    </Suspense>
  );
}
