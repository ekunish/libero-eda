"use client";

import { Play } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button, EmptyState } from "@/shared/ui/primitives";
import { ReplayWorkbench } from "@/widgets/replay-workbench";

export default function ReplayPage() {
  const params = useSearchParams();
  const replayId = params.get("replay_id");
  if (!replayId) {
    return (
      <div className="mx-auto mt-12 max-w-3xl overflow-hidden rounded-box border border-base-300 bg-base-100">
        <EmptyState
          icon={<Play size={28} />}
          title="Select a record to replay"
          body="Replay opens from a record in Recorded Data. Choose an Original LIBERO demonstration or a LIBERO-Plus training trajectory first."
        />
        <div className="flex justify-center border-t border-base-300 p-4">
          <Button asChild variant="primary">
            <Link href="/data/">Open Recorded Data</Link>
          </Button>
        </div>
      </div>
    );
  }
  return <ReplayWorkbench replayId={replayId} />;
}
