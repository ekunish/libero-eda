"use client";

import { useSearchParams } from "next/navigation";
import { ErrorPanel } from "@/shared/ui/primitives";
import { ReplayWorkbench } from "@/widgets/replay-workbench";

export default function ReplayPage() {
  const params = useSearchParams();
  const replayId = params.get("replay_id");
  if (!replayId)
    return <ErrorPanel error={new Error("A replay_id query parameter is required.")} />;
  return <ReplayWorkbench replayId={replayId} />;
}
