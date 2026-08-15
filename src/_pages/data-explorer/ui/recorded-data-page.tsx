"use client";
/* eslint-disable @next/next/no-img-element -- the API already returns fixed 128px WebP thumbnails */

import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Database, FileCode2, Play, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { formatTrainingPathTag } from "@/features/inspect-plus-training-metadata";
import {
  api,
  type Page,
  type RecordingDatasetId,
  replayThumbnailUrl,
  type TaskDetail,
  type TaskEpisodes,
  type TaskFamily,
  type TrainingEnvironmentCategories,
} from "@/shared/api";
import { useDesktopWorkspace } from "@/shared/lib/use-desktop-workspace";
import { cn, formatDuration } from "@/shared/lib/utils";
import { Button, ErrorPanel, IconButton, Input, Select, Skeleton } from "@/shared/ui/primitives";

const PAGE_SIZE = 50;
type DatasetMode = RecordingDatasetId;

const suiteMeta: Record<string, { label: string; description: string; order: number }> = {
  libero_spatial: { label: "Spatial", description: "10 spatial-relation tasks", order: 1 },
  libero_object: { label: "Object", description: "10 object-knowledge tasks", order: 2 },
  libero_goal: { label: "Goal", description: "10 goal-condition tasks", order: 3 },
  libero_90: {
    label: "LIBERO-100 / LIBERO-90",
    description: "90 policy-pretraining tasks in the original benchmark",
    order: 4,
  },
  libero_10: {
    label: "LIBERO-100 / LIBERO-10",
    description: "10 downstream lifelong-learning tasks in the original benchmark",
    order: 5,
  },
};

function parseOffset(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed % PAGE_SIZE === 0 ? parsed : 0;
}

function Pager({
  total,
  offset,
  onPage,
}: {
  total: number;
  offset: number;
  onPage: (n: number) => void;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-t border-base-300 px-3">
      <Button
        size="sm"
        variant="ghost"
        disabled={!offset}
        onClick={() => onPage(Math.max(0, offset - PAGE_SIZE))}
      >
        <ChevronLeft size={14} /> Previous
      </Button>
      <span className="mono text-xs text-base-content/55">
        {total ? `${offset + 1}–${Math.min(total, offset + PAGE_SIZE)}` : "0"} /{" "}
        {total.toLocaleString("en-US")}
      </span>
      <Button
        size="sm"
        variant="ghost"
        disabled={offset + PAGE_SIZE >= total}
        onClick={() => onPage(offset + PAGE_SIZE)}
      >
        Next <ChevronRight size={14} />
      </Button>
    </div>
  );
}

function TaskList({
  items,
  selected,
  dataset,
  onSelect,
}: {
  items: TaskFamily[];
  selected: string | null;
  dataset: DatasetMode;
  onSelect: (key: string) => void;
}) {
  const groups = useMemo(() => {
    const grouped = new Map<string, TaskFamily[]>();
    for (const item of items) grouped.set(item.suite, [...(grouped.get(item.suite) ?? []), item]);
    return [...grouped.entries()].sort(
      ([a], [b]) => (suiteMeta[a]?.order ?? 99) - (suiteMeta[b]?.order ?? 99),
    );
  }, [items]);
  return (
    <div className="h-full min-h-0 overflow-y-auto" data-testid="recorded-task-list">
      {groups.map(([suite, tasks]) => (
        <section key={suite}>
          <div className="sticky top-0 z-10 border-y border-base-300 bg-base-200 px-3 py-2 first:border-t-0">
            <div className="flex justify-between gap-3">
              <h2 className="text-xs font-semibold">{suiteMeta[suite]?.label ?? suite}</h2>
              <span className="mono text-xs text-base-content/50">{tasks.length}</span>
            </div>
            <p className="mt-0.5 truncate text-xs text-base-content/55">
              {suiteMeta[suite]?.description}
            </p>
          </div>
          {tasks.map((task) => (
            <button
              type="button"
              key={task.task_key}
              aria-current={selected === task.task_key ? "true" : undefined}
              onClick={() => onSelect(task.task_key)}
              className={cn(
                "w-full border-b border-base-300 px-3 py-2.5 text-left hover:bg-base-200",
                selected === task.task_key &&
                  "bg-primary/8 shadow-[inset_3px_0_var(--color-primary)]",
              )}
            >
              <p className="line-clamp-2 text-sm font-medium leading-5">{task.instruction}</p>
              <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-base-content/55">
                <span className="mono">
                  {suiteMeta[task.suite]?.label} #{task.suite_id}
                </span>
                <span>
                  {task.recording_sets
                    .find((set) => set.dataset_id === dataset)
                    ?.episode_count?.toLocaleString("en-US") ?? 0}{" "}
                  records
                </span>
              </div>
            </button>
          ))}
        </section>
      ))}
      {!items.length ? (
        <p className="p-5 text-sm text-base-content/60">No matching tasks.</p>
      ) : null}
    </div>
  );
}

function EpisodeList({
  episodes,
  dataset,
  offset,
  returnTo,
  onPage,
}: {
  episodes: TaskEpisodes | undefined;
  dataset: DatasetMode;
  offset: number;
  returnTo: string;
  onPage: (offset: number) => void;
}) {
  if (!episodes) return <Skeleton className="m-4 h-72" />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="hidden h-9 shrink-0 grid-cols-[4.75rem_minmax(0,1fr)_10rem_6rem_6rem_5rem] items-center border-b border-base-300 bg-base-200 px-4 text-xs font-semibold text-base-content/55 lg:grid">
        <span>Preview</span>
        <span>Record</span>
        <span>Path tag</span>
        <span>Frames</span>
        <span>Duration</span>
        <span className="text-right">Open</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul className="divide-y divide-base-300" aria-label="Records for the selected task">
          {episodes.items.map((episode) => {
            const replayParams = new URLSearchParams({ replay_scope: "task", return_to: returnTo });
            return (
              <li key={episode.replay_id}>
                <Link
                  href={`/replay?replay_id=${encodeURIComponent(episode.replay_id)}&${replayParams}`}
                  className="grid min-h-20 grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 hover:bg-base-200 lg:grid-cols-[4.75rem_minmax(0,1fr)_10rem_6rem_6rem_5rem]"
                >
                  <EpisodeThumbnail
                    replayId={episode.replay_id}
                    label={
                      dataset === "original_libero"
                        ? `Demo ${episode.episode_index + 1}`
                        : `Dataset episode #${episode.source_episode_id}`
                    }
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {dataset === "original_libero"
                        ? `Demo ${episode.episode_index + 1}`
                        : `Dataset episode #${episode.source_episode_id}`}
                    </span>
                    <span className="mono mt-0.5 block truncate text-xs text-base-content/45">
                      {episode.replay_id}
                    </span>
                  </span>
                  <span className="hidden truncate text-xs text-base-content/60 lg:block">
                    {episode.training_environment_category
                      ? formatTrainingPathTag(episode.training_environment_category)
                      : "—"}
                  </span>
                  <span className="mono hidden text-xs text-base-content/60 lg:block">
                    {episode.length}
                  </span>
                  <span className="mono hidden text-xs text-base-content/60 lg:block">
                    {formatDuration(episode.duration_sec)}
                  </span>
                  <span className="flex items-center justify-end gap-1.5 text-xs font-semibold text-primary">
                    <Play size={13} fill="currentColor" /> Replay
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        {!episodes.items.length ? (
          <p className="p-5 text-sm text-base-content/60">No records match the current filters.</p>
        ) : null}
      </div>
      <Pager total={episodes.total} offset={offset} onPage={onPage} />
    </div>
  );
}

function EpisodeThumbnail({ replayId, label }: { replayId: string; label: string }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  return (
    <div
      className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-sm border border-base-300 bg-base-200"
      data-testid={`episode-thumbnail-${replayId}`}
      data-status={status}
    >
      {status === "loading" ? <Skeleton className="absolute inset-0 rounded-none" /> : null}
      {status === "error" ? (
        <span className="px-1 text-center text-xs leading-3.5 text-base-content/45">
          Preview unavailable
        </span>
      ) : (
        // biome-ignore lint/performance/noImgElement: the API already returns a fixed 128px WebP
        <img
          src={replayThumbnailUrl(replayId)}
          alt={`Front preview for ${label}`}
          width={64}
          height={64}
          loading="lazy"
          decoding="async"
          onLoad={() => setStatus("ready")}
          onError={() => setStatus("error")}
          className={cn(
            "size-full object-contain transition-opacity",
            status === "ready" ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </div>
  );
}

function TaskInspector({
  family,
  dataset,
  episodes,
  categories,
  category,
  offset,
  returnTo,
  onCategory,
  onPage,
  onDefinition,
}: {
  family: TaskFamily | undefined;
  dataset: DatasetMode;
  episodes: TaskEpisodes | undefined;
  categories: TrainingEnvironmentCategories | undefined;
  category: string;
  offset: number;
  returnTo: string;
  onCategory: (value: string) => void;
  onPage: (value: number) => void;
  onDefinition: () => void;
}) {
  if (!family)
    return (
      <div className="grid min-h-0 flex-1 place-items-center text-sm text-base-content/55">
        Select a task.
      </div>
    );
  const set = family.recording_sets.find((item) => item.dataset_id === dataset);
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-base-100">
      <header className="shrink-0 border-b border-base-300 px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="mono text-xs text-base-content/50">
              {suiteMeta[family.suite]?.label} #{family.suite_id} ·{" "}
              {set?.episode_count?.toLocaleString("en-US") ?? 0} records
            </p>
            <h2 className="mt-1 line-clamp-2 text-base font-semibold leading-6">
              {family.instruction}
            </h2>
          </div>
          <Button size="sm" variant="ghost" onClick={onDefinition}>
            <FileCode2 size={14} /> Task definition
          </Button>
        </div>
        {dataset === "lerobot_libero_plus" ? (
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-base-300 pt-2">
            <p className="text-xs text-base-content/55">
              Training trajectories only; evaluation conditions are explored separately.
            </p>
            <label
              htmlFor="recorded-path-tag"
              className="flex shrink-0 items-center gap-2 text-xs font-semibold text-base-content/60"
            >
              Path tag
              <Select
                id="recorded-path-tag"
                size="sm"
                value={category}
                onChange={(event) => onCategory(event.target.value)}
                className="h-8 min-w-48 font-normal"
                aria-label="Distribution path tag"
              >
                <option value="all">All 5 path tags</option>
                {categories?.items.map((item) => (
                  <option key={item.category} value={item.category}>
                    {formatTrainingPathTag(item.category)} (
                    {item.episode_count.toLocaleString("en-US")})
                  </option>
                ))}
              </Select>
            </label>
          </div>
        ) : null}
      </header>
      <EpisodeList
        episodes={episodes}
        dataset={dataset}
        offset={offset}
        returnTo={returnTo}
        onPage={onPage}
      />
    </section>
  );
}

export default function RecordedDataPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const legacyCollection = searchParams.get("collection");
  const dataset: DatasetMode =
    searchParams.get("dataset") === "lerobot_libero_plus" || legacyCollection === "libero_plus"
      ? "lerobot_libero_plus"
      : "original_libero";
  const suite = searchParams.get("suite") ?? "all";
  const query = searchParams.get("q") ?? "";
  const selectedKey = searchParams.get("task");
  const category = searchParams.get("training_category") ?? "all";
  const offset = parseOffset(searchParams.get("episode_offset"));
  const [draft, setDraft] = useState(query);
  const [searchFocused, setSearchFocused] = useState(false);
  const mobileOpen = searchParams.get("sheet") === "recording";
  const desktopWorkspace = useDesktopWorkspace();
  const [definitionOpen, setDefinitionOpen] = useState(false);
  const returnTo = `/data${searchParams.size ? `?${searchParams}` : ""}`;

  const replaceParams = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      router.replace(`/data${next.size ? `?${next}` : ""}`, { scroll: false });
    },
    [router, searchParams],
  );
  useEffect(() => {
    if (!searchFocused) {
      const frame = requestAnimationFrame(() => setDraft(query));
      return () => cancelAnimationFrame(frame);
    }
  }, [query, searchFocused]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (draft.trim() !== query)
        replaceParams({ q: draft.trim() || null, task: null, episode_offset: null });
    }, 220);
    return () => clearTimeout(timer);
  }, [draft, query, replaceParams]);
  useEffect(() => {
    const allowedSuites =
      dataset === "lerobot_libero_plus"
        ? new Set(["all", "libero_spatial", "libero_object", "libero_goal", "libero_10"])
        : new Set([
            "all",
            "libero_spatial",
            "libero_object",
            "libero_goal",
            "libero_90",
            "libero_10",
          ]);
    const updates: Record<string, string | null> = {};
    const sheet = searchParams.get("sheet");
    if (sheet && sheet !== "recording") updates.sheet = null;
    if (legacyCollection) {
      updates.collection = null;
      updates.dataset = legacyCollection === "libero_plus" ? "lerobot_libero_plus" : null;
    }
    const rawDataset = searchParams.get("dataset");
    if (rawDataset && !["original_libero", "lerobot_libero_plus"].includes(rawDataset))
      updates.dataset = null;
    if (!allowedSuites.has(suite)) updates.suite = null;
    if (dataset === "original_libero" && searchParams.has("training_category"))
      updates.training_category = null;
    for (const obsolete of [
      "recording",
      "panel",
      "variant_offset",
      "tab",
      "t1",
      "category",
      "difficulty",
      "variant",
    ])
      if (searchParams.has(obsolete)) updates[obsolete] = null;
    const rawOffset = searchParams.get("episode_offset");
    if (rawOffset && parseOffset(rawOffset) === 0) updates.episode_offset = null;
    if (Object.keys(updates).length) replaceParams(updates);
  }, [dataset, legacyCollection, replaceParams, searchParams, suite]);

  const familyPath = new URLSearchParams({ limit: "130" });
  if (query) familyPath.set("q", query);
  if (suite !== "all") familyPath.set("suite", suite);
  if (dataset === "lerobot_libero_plus") familyPath.set("plus_source", "true");
  const families = useQuery({
    queryKey: ["recorded-data", dataset, query, suite],
    queryFn: () => api<Page<TaskFamily>>(`/task-families?${familyPath}`),
  });
  const selectedFamily =
    families.data?.items.find((item) => item.task_key === selectedKey) ?? families.data?.items[0];
  useEffect(() => {
    if (!families.data) return;
    if (!selectedFamily && selectedKey) replaceParams({ task: null });
    else if (selectedFamily && selectedKey !== selectedFamily.task_key)
      replaceParams({ task: selectedFamily.task_key });
  }, [families.data, replaceParams, selectedFamily, selectedKey]);

  const episodes = useQuery({
    queryKey: ["recorded-episodes", selectedFamily?.task_key, dataset, category, offset],
    queryFn: () =>
      api<TaskEpisodes>(
        `/tasks/${encodeURIComponent(selectedFamily?.task_key ?? "")}/episodes?dataset_id=${dataset}&limit=${PAGE_SIZE}&offset=${offset}${dataset === "lerobot_libero_plus" && category !== "all" ? `&training_environment_category=${encodeURIComponent(category)}` : ""}`,
      ),
    enabled: Boolean(selectedFamily),
  });
  const categories = useQuery({
    queryKey: ["training-categories", selectedFamily?.task_key],
    queryFn: () =>
      api<TrainingEnvironmentCategories>(
        `/datasets/lerobot_libero_plus/training-environment-categories?base_task_key=${encodeURIComponent(selectedFamily?.task_key ?? "")}`,
      ),
    enabled: dataset === "lerobot_libero_plus" && Boolean(selectedFamily),
  });
  const definition = useQuery({
    queryKey: ["recorded-definition", selectedFamily?.task_key],
    queryFn: () => api<TaskDetail>(`/tasks/${encodeURIComponent(selectedFamily?.task_key ?? "")}`),
    enabled: definitionOpen && Boolean(selectedFamily),
  });
  useEffect(() => {
    if (!episodes.isSuccess || !offset) return;
    const total = episodes.data.total;
    const canonicalOffset = total ? Math.floor((total - 1) / PAGE_SIZE) * PAGE_SIZE : 0;
    if (offset >= total)
      replaceParams({ episode_offset: canonicalOffset ? String(canonicalOffset) : null });
  }, [episodes.data, episodes.isSuccess, offset, replaceParams]);

  if (families.isError) return <ErrorPanel error={families.error} />;
  const inspector = (
    <TaskInspector
      family={selectedFamily}
      dataset={dataset}
      episodes={episodes.data}
      categories={categories.data}
      category={category}
      offset={offset}
      returnTo={returnTo}
      onCategory={(value) =>
        replaceParams({ training_category: value === "all" ? null : value, episode_offset: null })
      }
      onPage={(value) => replaceParams({ episode_offset: value ? String(value) : null })}
      onDefinition={() => setDefinitionOpen(true)}
    />
  );
  return (
    <div className="viewport-page flex min-h-0 flex-col gap-2">
      <header className="flex shrink-0 flex-wrap items-center gap-2">
        <fieldset className="join">
          <legend className="sr-only">Recorded dataset</legend>
          <Button
            size="sm"
            variant={dataset === "original_libero" ? "primary" : "secondary"}
            aria-pressed={dataset === "original_libero"}
            onClick={() =>
              replaceParams({
                dataset: null,
                task: null,
                suite: null,
                training_category: null,
                episode_offset: null,
              })
            }
            className="join-item"
          >
            Original LIBERO <span className="mono text-xs opacity-70">6,500</span>
          </Button>
          <Button
            size="sm"
            variant={dataset === "lerobot_libero_plus" ? "primary" : "secondary"}
            aria-pressed={dataset === "lerobot_libero_plus"}
            onClick={() =>
              replaceParams({
                dataset: "lerobot_libero_plus",
                task: null,
                suite: null,
                training_category: null,
                episode_offset: null,
              })
            }
            className="join-item"
          >
            LIBERO-Plus Training <span className="mono text-xs opacity-70">14,347</span>
          </Button>
        </fieldset>
        <label htmlFor="recorded-task-search" className="relative min-w-56 flex-1">
          <span className="sr-only">Search tasks</span>
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40"
            size={15}
          />
          <Input
            id="recorded-task-search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Search instructions or task names"
            className="w-full pl-9"
          />
        </label>
        <Select
          aria-label="Task suite"
          value={suite}
          onChange={(event) =>
            replaceParams({
              suite: event.target.value === "all" ? null : event.target.value,
              task: null,
              episode_offset: null,
            })
          }
        >
          <option value="all">All task groups</option>
          <option value="libero_spatial">Spatial</option>
          <option value="libero_object">Object</option>
          <option value="libero_goal">Goal</option>
          {dataset === "original_libero" ? <option value="libero_90">LIBERO-90</option> : null}
          <option value="libero_10">LIBERO-10</option>
        </Select>
        <Button size="sm" variant="ghost" asChild>
          <Link
            href={`/sources?source=${dataset === "original_libero" ? "original_libero_demonstrations" : "libero_plus_lerobot"}`}
          >
            <Database size={14} /> Source
          </Link>
        </Button>
      </header>
      <section className="min-h-0 flex-1 overflow-hidden border border-base-300 bg-base-100">
        {episodes.isError || categories.isError ? (
          <div className="p-3">
            <ErrorPanel error={episodes.error ?? categories.error} />
          </div>
        ) : null}
        <div className="hidden h-full min-h-0 xl:block">
          <Group
            orientation="horizontal"
            className="h-full min-h-0"
            id="recorded-data-layout"
            defaultLayout={{ tasks: 22, records: 78 }}
          >
            <Panel id="tasks" defaultSize="22%" minSize={260} maxSize={440} className="min-h-0">
              <TaskList
                items={families.data?.items ?? []}
                selected={selectedFamily?.task_key ?? null}
                dataset={dataset}
                onSelect={(task) =>
                  replaceParams({ task, episode_offset: null, training_category: null })
                }
              />
            </Panel>
            <Separator className="group relative w-px bg-base-300 outline-none focus-visible:bg-primary">
              <span className="absolute inset-y-0 -left-1.5 w-3 cursor-col-resize group-hover:bg-primary/10" />
            </Separator>
            <Panel id="records" defaultSize="78%" minSize={520} className="min-h-0">
              {inspector}
            </Panel>
          </Group>
        </div>
        <div className="h-full min-h-0 xl:hidden">
          <TaskList
            items={families.data?.items ?? []}
            selected={selectedFamily?.task_key ?? null}
            dataset={dataset}
            onSelect={(task) => {
              replaceParams({
                task,
                episode_offset: null,
                training_category: null,
                sheet: "recording",
              });
            }}
          />
        </div>
      </section>
      <Dialog.Root
        open={mobileOpen && !desktopWorkspace}
        onOpenChange={(open) => {
          replaceParams({ sheet: open ? "recording" : null });
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/45 xl:hidden" />
          <Dialog.Content className="fixed inset-x-0 bottom-0 z-[71] flex h-[92dvh] flex-col overflow-hidden rounded-t-xl border border-base-300 bg-base-100 xl:hidden">
            <Dialog.Title className="sr-only">Selected task records</Dialog.Title>
            <Dialog.Description className="sr-only">
              Recorded trajectories for the selected task
            </Dialog.Description>
            <Dialog.Close asChild>
              <IconButton
                aria-label="Close records"
                variant="ghost"
                className="absolute right-3 top-3 z-10"
              >
                <X size={16} />
              </IconButton>
            </Dialog.Close>
            {inspector}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={definitionOpen} onOpenChange={setDefinitionOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/45" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[81] flex max-h-[80vh] w-[min(1000px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border border-base-300 bg-base-100 shadow-xl">
            <div className="flex items-center justify-between border-b border-base-300 p-4">
              <Dialog.Title className="font-semibold">Original LIBERO BDDL</Dialog.Title>
              <Dialog.Close asChild>
                <IconButton aria-label="Close task definition" variant="ghost">
                  <X size={16} />
                </IconButton>
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">
              Definition of the selected source task
            </Dialog.Description>
            {definition.data ? (
              <pre className="mono overflow-auto whitespace-pre-wrap p-5 text-xs leading-5">
                {definition.data.bddl}
              </pre>
            ) : (
              <Skeleton className="m-5 h-64" />
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
