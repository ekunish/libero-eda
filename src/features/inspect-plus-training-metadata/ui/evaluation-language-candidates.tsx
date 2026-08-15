"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Languages, X } from "lucide-react";
import Link from "next/link";
import { api, type EvaluationCondition, type Page } from "@/shared/api";
import { Badge, Button, ErrorPanel, IconButton, Skeleton } from "@/shared/ui/primitives";

const LANGUAGE_CATEGORY = "Language Instructions";
const skeletonKeys = ["a", "b", "c", "d", "e", "f", "g", "h"];

function evaluationHref(condition: EvaluationCondition): string {
  const params = new URLSearchParams({
    base_task: condition.base_task.task_key,
    category: LANGUAGE_CATEGORY,
    condition: condition.task_key,
  });
  return `/evaluation?${params.toString()}`;
}

export function EvaluationLanguageCandidates({
  baseTaskKey,
  originalInstruction,
  storedInstruction,
}: {
  baseTaskKey: string;
  originalInstruction: string;
  storedInstruction: string;
}) {
  const params = new URLSearchParams({
    base_task_key: baseTaskKey,
    category: LANGUAGE_CATEGORY,
    limit: "500",
  });
  const query = useQuery({
    queryKey: ["evaluation-language-candidates", baseTaskKey],
    queryFn: () => api<Page<EvaluationCondition>>(`/evaluation/conditions?${params}`),
  });
  const complete = query.data ? query.data.items.length === query.data.total : false;
  const items = [...(query.data?.items ?? [])].sort(
    (left, right) =>
      (left.difficulty ?? 99) - (right.difficulty ?? 99) ||
      left.suite_id - right.suite_id ||
      left.task_key.localeCompare(right.task_key),
  );

  return (
    <Dialog.Root>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-base-300 pt-3">
        <Badge tone="violet">
          <Languages size={12} aria-hidden /> language path tag
        </Badge>
        <Button size="sm" variant="secondary" asChild>
          <Dialog.Trigger>
            Evaluation rewrites for this task
            {query.data ? ` · ${query.data.total.toLocaleString("en-US")}` : ""}
          </Dialog.Trigger>
        </Button>
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/45" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[81] flex max-h-[min(54rem,92dvh)] w-[min(68rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-xl focus:outline-none">
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-base-300 px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-semibold">
                Published evaluation instruction rewrites
              </Dialog.Title>
              <Dialog.Description className="mt-1 max-w-3xl text-sm leading-6 text-base-content/65">
                These are Language Instructions from the LIBERO-Plus evaluation conditions for the
                same source task. The public training artifact does not identify which rewrite, if
                any, was used for this episode.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton variant="ghost" aria-label="Close evaluation rewrites">
                <X size={17} />
              </IconButton>
            </Dialog.Close>
          </header>

          <div className="shrink-0 border-b border-base-300 bg-base-200/45 px-5 py-3 sm:px-6">
            <dl className="grid gap-3 text-sm md:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold text-base-content/55">Source instruction</dt>
                <dd className="mt-1 leading-5">{originalInstruction}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-base-content/55">
                  Stored training instruction
                </dt>
                <dd className="mt-1 leading-5">{storedInstruction}</dd>
              </div>
            </dl>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {query.isError ? (
              <div className="p-5 sm:p-6">
                <ErrorPanel title="Could not load evaluation rewrites" error={query.error} />
              </div>
            ) : query.isLoading ? (
              <div className="grid gap-2 p-5 sm:p-6">
                {skeletonKeys.map((key) => (
                  <Skeleton key={key} className="h-20" />
                ))}
              </div>
            ) : !complete ? (
              <div className="p-5 sm:p-6">
                <ErrorPanel
                  title="Could not load the complete rewrite set"
                  error={new Error(`${query.data?.items.length ?? 0} / ${query.data?.total ?? 0}`)}
                />
              </div>
            ) : (
              <ol className="divide-y divide-base-300" aria-label="Evaluation rewrite candidates">
                {items.map((item, index) => (
                  <li key={item.task_key}>
                    <Link
                      href={evaluationHref(item)}
                      className="grid gap-2 px-5 py-4 hover:bg-base-200 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto] sm:items-start sm:px-6"
                    >
                      <span className="mono text-xs text-base-content/45">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 text-sm font-medium leading-6">
                        {item.instruction}
                      </span>
                      <span className="flex items-center gap-2">
                        <Badge tone={item.difficulty == null ? "neutral" : "cyan"}>
                          {item.difficulty == null ? "Unlabeled" : `L${item.difficulty}`}
                        </Badge>
                        <ExternalLink size={14} className="text-base-content/45" aria-hidden />
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
