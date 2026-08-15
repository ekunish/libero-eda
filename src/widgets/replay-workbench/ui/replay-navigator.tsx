"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleX,
  PanelLeft,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { formatTrainingPathTag } from "@/features/inspect-plus-training-metadata";
import {
  api,
  type ReplayContext,
  type ReplayContextItem,
  type ReplayManifest,
  type TrainingEnvironmentCategories,
} from "@/shared/api";
import { cn, formatDuration } from "@/shared/lib/utils";
import {
  Badge,
  Button,
  ErrorPanel,
  IconButton,
  Input,
  Select,
  Skeleton,
} from "@/shared/ui/primitives";
import {
  replayHref,
  replayKeys,
  replayQueryState,
  sanitizeReplayParams,
} from "../model/replay-context-url";

function recordingLabel(item: ReplayContextItem): string {
  if (item.dataset_id === "original_libero") return `Demo ${item.episode_id + 1}`;
  if (item.dataset_id === "lerobot_libero_plus") {
    return `Dataset episode #${item.source_episode_id ?? item.episode_id}`;
  }
  return `init ${item.init_index ?? item.episode_id}`;
}

function outcomeBadge(item: ReplayContextItem) {
  if (item.outcome.success == null) return null;
  return item.outcome.success ? (
    <Badge tone="green" className="shrink-0">
      <CheckCircle2 size={11} /> Success
    </Badge>
  ) : (
    <Badge tone="red" className="shrink-0">
      <CircleX size={11} /> Failure
    </Badge>
  );
}

function scopeLabel(context: ReplayContext | undefined): string {
  if (!context) return "Loading from the current record";
  if (context.scope.kind === "run") return "Current run";
  if (context.scope.kind === "dataset") return "Entire dataset";
  return "Current task";
}

function ReplaySearchForm({
  instance,
  committedValue,
  onCommit,
}: {
  instance: "desktop" | "drawer";
  committedValue: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(committedValue);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = draft.trim();
    setDraft(value);
    onCommit(value);
  };
  return (
    <form onSubmit={submit} className="grid gap-1">
      <label htmlFor={`replay-recording-search-${instance}`} className="text-xs font-medium">
        Search records
      </label>
      <div className="join w-full">
        <div className="relative min-w-0 flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/45"
          />
          <Input
            id={`replay-recording-search-${instance}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Task or record number"
            className="join-item w-full pl-8"
          />
        </div>
        <Button type="submit" size="sm" className="join-item h-9 border-base-300">
          Search
        </Button>
      </div>
    </form>
  );
}

function NavigatorBody({
  replayId,
  context,
  isLoading,
  error,
  onNavigate,
  instance,
  manifest,
}: {
  replayId: string;
  context: ReplayContext | undefined;
  isLoading: boolean;
  error: unknown;
  onNavigate?: () => void;
  instance: "desktop" | "drawer";
  manifest: ReplayManifest;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = sanitizeReplayParams(new URLSearchParams(searchParams.toString()), manifest);
  const state = replayQueryState(params);

  const setParams = (
    changes: Partial<Record<(typeof replayKeys)[keyof typeof replayKeys], string | null>>,
  ) => {
    const next = sanitizeReplayParams(new URLSearchParams(searchParams.toString()), manifest);
    for (const [key, value] of Object.entries(changes)) {
      if (value == null || value === "") next.delete(key);
      else next.set(key, value);
    }
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };
  const plusDataset = context?.scope.dataset_id === "lerobot_libero_plus";
  const categoriesQuery = useQuery({
    queryKey: ["training-environment-categories", context?.scope.kind, context?.scope.task_key],
    queryFn: () => {
      const categoryParams = new URLSearchParams();
      if (context?.scope.kind === "task" && context.scope.task_key) {
        categoryParams.set("base_task_key", context.scope.task_key);
      }
      return api<TrainingEnvironmentCategories>(
        `/datasets/lerobot_libero_plus/training-environment-categories${categoryParams.size ? `?${categoryParams}` : ""}`,
      );
    },
    enabled: plusDataset,
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-base-100">
      <div className="shrink-0 border-b border-base-300 p-3">
        <div
          className={cn(
            "flex items-center justify-between gap-3",
            instance === "drawer" && "pr-10",
          )}
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold">Records</p>
            <p className="mt-0.5 truncate text-xs text-base-content/60">{scopeLabel(context)}</p>
          </div>
          {context ? <Badge>{context.total.toLocaleString("en-US")}</Badge> : null}
        </div>

        <div className="mt-3 grid gap-2">
          {context?.scope.kind === "run" ? (
            <label htmlFor={`replay-scope-${instance}`} className="grid gap-1 text-xs font-medium">
              Scope
              <Select
                id={`replay-scope-${instance}`}
                aria-label="Record list scope"
                value="run"
                disabled
                tone="subtle"
                className="w-full"
              >
                <option value="run">Current run</option>
              </Select>
            </label>
          ) : context ? (
            <label htmlFor={`replay-scope-${instance}`} className="grid gap-1 text-xs font-medium">
              Scope
              <Select
                id={`replay-scope-${instance}`}
                aria-label="Record list scope"
                value={state.scope === "dataset" ? "dataset" : "task"}
                onChange={(event) =>
                  setParams({
                    [replayKeys.scope]: event.target.value,
                    [replayKeys.series]: null,
                    [replayKeys.offset]: null,
                  })
                }
                className="w-full"
              >
                <option value="task">Current task</option>
                <option value="dataset">Entire dataset</option>
              </Select>
            </label>
          ) : null}

          <ReplaySearchForm
            key={state.q}
            instance={instance}
            committedValue={state.q}
            onCommit={(q) => setParams({ [replayKeys.q]: q || null, [replayKeys.offset]: null })}
          />

          {plusDataset ? (
            categoriesQuery.isError ? (
              <ErrorPanel title="Could not load path tags" error={categoriesQuery.error} />
            ) : (
              <div className="grid gap-2">
                <label
                  htmlFor={`replay-path-tag-${instance}`}
                  className="grid gap-1 text-xs font-medium"
                >
                  Distribution path tag
                  <Select
                    id={`replay-path-tag-${instance}`}
                    aria-label="Replay distribution path tag"
                    value={state.series}
                    disabled={!categoriesQuery.data}
                    onChange={(event) =>
                      setParams({
                        [replayKeys.series]: event.target.value || null,
                        [replayKeys.offset]: null,
                      })
                    }
                    className="w-full"
                  >
                    <option value="">All 5 path tags</option>
                    {categoriesQuery.data?.items.map((item) => (
                      <option key={item.category} value={item.category}>
                        {formatTrainingPathTag(item.category)}（
                        {item.episode_count.toLocaleString("en-US")})
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
            )
          ) : null}

          {context?.scope.kind === "run" ? (
            <label
              htmlFor={`replay-outcome-${instance}`}
              className="grid gap-1 text-xs font-medium"
            >
              Outcome
              <Select
                id={`replay-outcome-${instance}`}
                aria-label="Replay outcome"
                value={state.outcome}
                onChange={(event) =>
                  setParams({
                    [replayKeys.outcome]: event.target.value === "all" ? null : event.target.value,
                    [replayKeys.offset]: null,
                  })
                }
                className="w-full"
              >
                <option value="all">All outcomes</option>
                <option value="success">Success only</option>
                <option value="failure">Failure only</option>
              </Select>
            </label>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="p-3">
          <ErrorPanel title="Could not load records" error={error} />
        </div>
      ) : isLoading || !context ? (
        <div className="grid gap-2 p-3">
          {["a", "b", "c", "d", "e", "f", "g", "h"].map((key) => (
            <Skeleton key={key} className="h-16" />
          ))}
        </div>
      ) : (
        <>
          {context.current_index == null ? (
            <p role="status" className="border-b border-warning/25 bg-warning/10 px-3 py-2 text-xs">
              The current record is outside this filter. Select another record from the list.
            </p>
          ) : null}
          <nav
            aria-label="Filtered records"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          >
            <ol className="divide-y divide-base-300">
              {context.items.map((item) => {
                const current = item.replay_id === replayId;
                return (
                  <li key={item.replay_id}>
                    <Link
                      href={replayHref(item.replay_id, params)}
                      aria-current={current ? "page" : undefined}
                      onClick={onNavigate}
                      className={cn(
                        "block border-l-2 px-3 py-2.5 transition-colors",
                        current
                          ? "border-primary bg-primary/10"
                          : "border-transparent hover:bg-base-200",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="mono truncate text-xs font-semibold">
                          {recordingLabel(item)}
                        </span>
                        {outcomeBadge(item)}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-4 text-base-content/65">
                        {item.task_name}
                      </p>
                      <div className="mono mt-1.5 flex items-center gap-2 text-xs text-base-content/50">
                        <span>{item.state_count} frames</span>
                        <span>{formatDuration(item.duration_sec)}</span>
                        {item.training_environment_category ? (
                          <span className="ml-auto truncate">
                            path: {formatTrainingPathTag(item.training_environment_category)}
                          </span>
                        ) : null}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ol>
            {!context.items.length ? (
              <p className="p-4 text-sm text-base-content/60">No records match these filters.</p>
            ) : null}
          </nav>
          <div className="shrink-0 border-t border-base-300 p-3">
            <div className="mb-2 flex items-center justify-between text-xs text-base-content/60">
              <span>
                {context.items.length
                  ? `${context.offset + 1}–${context.offset + context.items.length}`
                  : "0"}{" "}
                / {context.total.toLocaleString("en-US")}
              </span>
              {context.current_index != null ? (
                <span>Current #{context.current_index + 1}</span>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={context.offset === 0}
                onClick={() =>
                  setParams({
                    [replayKeys.offset]: String(Math.max(0, context.offset - context.limit)),
                  })
                }
              >
                <ChevronLeft size={14} /> Previous 50
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={context.offset + context.limit >= context.total}
                onClick={() =>
                  setParams({ [replayKeys.offset]: String(context.offset + context.limit) })
                }
              >
                Next 50 <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function ReplayNavigator({
  replayId,
  manifest,
  context,
  isLoading,
  error,
}: {
  replayId: string;
  manifest: ReplayManifest;
  context: ReplayContext | undefined;
  isLoading: boolean;
  error: unknown;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <aside
        aria-label="Record browser"
        data-testid="replay-navigator"
        className="hidden min-h-0 overflow-hidden border border-base-300 bg-base-100 xl:block"
      >
        <NavigatorBody
          replayId={replayId}
          context={context}
          isLoading={isLoading}
          error={error}
          instance="desktop"
          manifest={manifest}
        />
      </aside>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <Button size="sm" variant="secondary" className="xl:hidden">
            <PanelLeft size={15} /> Records
            {context ? <span className="mono">{context.total}</span> : null}
          </Button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/45 xl:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-[71] w-[min(25rem,calc(100vw-2rem))] overflow-hidden border-r border-base-300 bg-base-100 shadow-xl xl:hidden">
            <Dialog.Title className="sr-only">Filtered records</Dialog.Title>
            <Dialog.Description className="sr-only">
              Set the scope and filters, then select a record to replay.
            </Dialog.Description>
            <Dialog.Close asChild>
              <IconButton
                aria-label="Close record list"
                variant="ghost"
                className="absolute right-2 top-2 z-10"
              >
                <X size={16} />
              </IconButton>
            </Dialog.Close>
            <NavigatorBody
              replayId={replayId}
              context={context}
              isLoading={isLoading}
              error={error}
              onNavigate={() => setOpen(false)}
              instance="drawer"
              manifest={manifest}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
