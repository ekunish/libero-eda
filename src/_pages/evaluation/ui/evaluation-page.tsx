"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Database, Filter, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  api,
  type EvaluationCondition,
  type EvaluationConditionDetail,
  type EvaluationSceneRecord,
  type EvaluationSummary,
  type Page,
  type TaskFamily,
} from "@/shared/api";
import { useDesktopWorkspace } from "@/shared/lib/use-desktop-workspace";
import { cn } from "@/shared/lib/utils";
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
  EvaluationSceneViewport,
  parseTaskDefinition,
  resolveTaskCues,
  type TaskCueResolution,
  TaskDefinitionInspector,
} from "@/widgets/replay-workbench";

const PAGE_SIZE = 50;
const difficultyKeys = ["1", "2", "3", "4", "5", "unassigned"] as const;
const categoryLabels: Record<string, string> = {
  "Background Textures": "Background",
  "Camera Viewpoints": "Camera",
  "Language Instructions": "Language",
  "Light Conditions": "Lighting",
  "Lighting Conditions": "Lighting",
  "Objects Layout": "Objects",
  "Object Layouts": "Objects",
  "Robot Initial States": "Robot init",
  "Sensor Noise": "Sensor noise",
};
const suiteLabels: Record<string, string> = {
  libero_spatial: "Spatial",
  libero_object: "Object",
  libero_goal: "Goal",
  libero_10: "LIBERO-10",
};
const allowedEvaluationCategories = new Set([
  "Background Textures",
  "Camera Viewpoints",
  "Language Instructions",
  "Light Conditions",
  "Lighting Conditions",
  "Objects Layout",
  "Object Layouts",
  "Robot Initial States",
  "Sensor Noise",
]);

function difficultyLabel(value: number | null): string {
  return value == null ? "Unassigned" : `L${value}`;
}
function parseOffset(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed % PAGE_SIZE === 0 ? parsed : 0;
}

function EvaluationMatrix({
  summary,
  selectedCategory,
  selectedDifficulty,
  onSelect,
  onReset,
}: {
  summary: EvaluationSummary;
  selectedCategory: string | null;
  selectedDifficulty: string | null;
  onSelect: (category: string, difficulty: string) => void;
  onReset: () => void;
}) {
  const counts = useMemo(
    () =>
      new Map(
        summary.matrix.map((item) => [
          `${item.category}:${item.difficulty ?? "unassigned"}`,
          item.count,
        ]),
      ),
    [summary.matrix],
  );
  return (
    <div className="flex h-full min-h-0 flex-col bg-base-100" data-testid="evaluation-matrix">
      <div className="shrink-0 border-b border-base-300 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Condition matrix</h2>
            <p className="mt-0.5 text-xs text-base-content/55">
              Category × reference-model difficulty
            </p>
          </div>
          <Badge>{summary.total_conditions.toLocaleString("en-US")}</Badge>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <div className="grid min-w-[300px] grid-cols-[minmax(104px,1fr)_repeat(6,32px)] items-center text-xs">
          <span className="px-1 py-1 font-semibold text-base-content/55">Category</span>
          {difficultyKeys.map((key) => (
            <span key={key} className="py-1 text-center font-semibold text-base-content/50">
              {key === "unassigned" ? "—" : `L${key}`}
            </span>
          ))}
          {summary.categories.map((category) => (
            <div key={category} className="contents">
              <span
                className="truncate border-t border-base-300 px-1 py-2 font-medium"
                title={category}
              >
                {categoryLabels[category] ?? category}
              </span>
              {difficultyKeys.map((difficulty) => {
                const count = counts.get(`${category}:${difficulty}`) ?? 0;
                const selected = selectedCategory === category && selectedDifficulty === difficulty;
                return (
                  <button
                    type="button"
                    key={difficulty}
                    disabled={!count}
                    aria-pressed={selected}
                    aria-label={`${categoryLabels[category] ?? category}, ${difficulty === "unassigned" ? "difficulty unassigned" : `difficulty L${difficulty}`}, ${count} conditions`}
                    onClick={() => onSelect(category, difficulty)}
                    className={cn(
                      "m-0.5 grid size-7 place-items-center rounded-field border border-transparent font-mono text-[10px] transition-colors",
                      count
                        ? "hover:border-primary/40 hover:bg-primary/10"
                        : "text-base-content/20",
                      selected && "border-primary bg-primary text-primary-content hover:bg-primary",
                    )}
                  >
                    {count || "·"}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="shrink-0 border-t border-base-300 p-2">
        <Button
          size="sm"
          variant="ghost"
          className="w-full"
          disabled={!selectedCategory && !selectedDifficulty}
          onClick={onReset}
        >
          Clear matrix selection
        </Button>
      </div>
    </div>
  );
}

function ConditionList({
  page,
  selected,
  testId,
  onSelect,
  onPage,
}: {
  page: Page<EvaluationCondition> | undefined;
  selected: string | null;
  testId: string;
  onSelect: (key: string) => void;
  onPage: (offset: number) => void;
}) {
  if (!page) return <Skeleton className="m-3 h-72" />;
  return (
    <div className="flex h-full min-h-0 flex-col bg-base-100">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-base-300 px-3">
        <h2 className="text-sm font-semibold">Conditions</h2>
        <span className="mono text-xs text-base-content/55">
          {page.total.toLocaleString("en-US")}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid={testId}>
        {page.items.map((item) => (
          <button
            type="button"
            key={item.task_key}
            aria-current={selected === item.task_key ? "true" : undefined}
            onClick={() => onSelect(item.task_key)}
            className={cn(
              "w-full border-b border-base-300 px-3 py-2.5 text-left hover:bg-base-200",
              selected === item.task_key &&
                "bg-primary/8 shadow-[inset_3px_0_var(--color-primary)]",
            )}
          >
            <div className="flex items-center gap-1.5">
              <Badge tone={item.category === "Language Instructions" ? "violet" : "cyan"}>
                {categoryLabels[item.category ?? ""] ?? item.category}
              </Badge>
              <Badge tone={item.difficulty == null ? "amber" : "neutral"}>
                {difficultyLabel(item.difficulty)}
              </Badge>
            </div>
            <p className="mt-1.5 line-clamp-2 text-sm font-medium leading-5">{item.instruction}</p>
            <p className="mono mt-1 truncate text-xs text-base-content/45">
              {suiteLabels[item.base_task.suite]} #{item.base_task.suite_id} · {item.task_key}
            </p>
          </button>
        ))}
        {!page.items.length ? (
          <p className="p-5 text-sm text-base-content/60">
            No conditions match the current filters.
          </p>
        ) : null}
      </div>
      <div className="flex h-10 shrink-0 items-center justify-between border-t border-base-300 px-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={!page.offset}
          onClick={() => onPage(Math.max(0, page.offset - PAGE_SIZE))}
        >
          <ChevronLeft size={14} /> Previous
        </Button>
        <span className="mono text-xs text-base-content/55">
          {page.total ? `${page.offset + 1}–${Math.min(page.total, page.offset + PAGE_SIZE)}` : "0"}{" "}
          / {page.total.toLocaleString("en-US")}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={page.offset + page.limit >= page.total}
          onClick={() => onPage(page.offset + PAGE_SIZE)}
        >
          Next <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  );
}

const settingLabels: Record<string, string> = {
  category: "Category",
  definition_variant: "Definition variant",
  horizontal_view_degrees: "Horizontal view",
  vertical_view_degrees: "Vertical view",
  distance_scale: "Camera distance scale",
  endpoint_rotation_degrees: "Endpoint rotation",
  endpoint_vertical_degrees: "Endpoint vertical angle",
  robot_initial_variant: "Robot initial variant",
  sensor_noise_variant: "Sensor noise variant",
};

function settingValue(key: string, value: string | number): string {
  if (key.endsWith("_degrees")) return `${value}°`;
  if (key === "distance_scale") return `${value}×`;
  if (key === "robot_initial_variant") return Number(value) ? `Panda${value}` : "Panda";
  if (key === "sensor_noise_variant") return Number(value) ? `Variant ${value}` : "None";
  return String(value);
}

function ConditionInspector({
  detail,
  scene,
  cueResolution,
  taskCuesEnabled,
}: {
  detail: EvaluationConditionDetail | undefined;
  scene: EvaluationSceneRecord | undefined;
  cueResolution: TaskCueResolution | null;
  taskCuesEnabled: boolean;
}) {
  if (!detail)
    return (
      <div className="grid h-full place-items-center text-sm text-base-content/55">
        Select an evaluation condition.
      </div>
    );
  const languageChanged = detail.category === "Language Instructions";
  const parsed = parseTaskDefinition(detail.bddl);
  return (
    <article
      className="h-full min-h-0 overflow-y-auto bg-base-100"
      data-testid="evaluation-condition-detail"
    >
      <header className="border-b border-base-300 px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="cyan">{categoryLabels[detail.category ?? ""] ?? detail.category}</Badge>
          <Badge tone={detail.difficulty == null ? "amber" : "neutral"}>
            {difficultyLabel(detail.difficulty)}
          </Badge>
        </div>
        <h2 className="mt-2 text-lg font-semibold leading-7">{detail.instruction}</h2>
        <p className="mono mt-1 text-xs text-base-content/45">{detail.task_key}</p>
      </header>
      <div className="divide-y divide-base-300">
        <section className="p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/55">
            Condition
          </h3>
          <dl className="mt-2 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
            {(scene ? Object.entries(scene.settings) : [["category", detail.category ?? ""]]).map(
              ([key, value]) => (
                <div className="contents" key={key}>
                  <dt className="text-base-content/45">{settingLabels[key] ?? key}</dt>
                  <dd className="mono break-all">{settingValue(key, value)}</dd>
                </div>
              ),
            )}
          </dl>
          {detail.category === "Sensor Noise" ? (
            <p className="mt-2 text-xs leading-5 text-base-content/55">
              Sensor noise is applied in image space during evaluation. The 3D pane shows the
              settled simulator state and does not composite that camera-image effect.
            </p>
          ) : null}
          {detail.category === "Language Instructions" ? (
            <p className="mt-2 text-xs leading-5 text-base-content/55">
              This condition changes the instruction passed to the policy, not the physical initial
              state. Language variants of the same source task intentionally share the same scene.
            </p>
          ) : null}
        </section>
        <section className="p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/55">
            Instruction
          </h3>
          <p
            className={cn(
              "mt-2 text-sm leading-6",
              languageChanged && "font-semibold text-secondary",
            )}
          >
            {detail.instruction}
          </p>
          {languageChanged ? (
            <div className="mt-2 border-l-2 border-secondary pl-2 text-xs leading-5 text-base-content/60">
              <p className="font-medium text-base-content">Source task</p>
              <p>{detail.base_task.instruction}</p>
            </div>
          ) : null}
        </section>
        <TaskDefinitionInspector
          detail={detail}
          parsed={parsed}
          cueResolution={cueResolution}
          sourceTask={false}
          taskCuesEnabled={taskCuesEnabled}
        />
        <section className="p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/55">
            Official initial state
          </h3>
          <p className="mt-2 text-xs leading-5 text-base-content/65">
            Official state index 0, followed by five zero actions. Environment construction and
            reset are fixed to LIBERO&apos;s default seed 10,000 so every published scene is
            reproducible. Objects and joints are read-only in this EDA; the viewpoint remains fully
            interactive.
          </p>
          {scene ? (
            <dl className="mt-2 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-[11px]">
              <dt className="text-base-content/45">Init file</dt>
              <dd className="mono break-all">{scene.initialization.init_state}</dd>
              <dt className="text-base-content/45">BDDL</dt>
              <dd className="mono break-all">{scene.initialization.resolved_bddl}</dd>
              <dt className="text-base-content/45">Env seed</dt>
              <dd className="mono">{scene.initialization.environment_seed.toLocaleString()}</dd>
              <dt className="text-base-content/45">Bodies</dt>
              <dd className="mono">{scene.snapshot.bodies.length}</dd>
              <dt className="text-base-content/45">Visual geoms</dt>
              <dd className="mono">{scene.snapshot.geoms.length}</dd>
            </dl>
          ) : (
            <Skeleton className="mt-2 h-16" />
          )}
        </section>
        <section className="p-3 text-xs leading-5 text-base-content/60">
          <div className="flex flex-wrap gap-2 pb-3">
            <Button size="xs" variant="ghost" className="border-base-300" asChild>
              <Link href={`/data?task=${encodeURIComponent(detail.base_task.task_key)}`}>
                Original demonstrations
              </Link>
            </Button>
            <Button size="xs" variant="ghost" className="border-base-300" asChild>
              <Link
                href={`/data?dataset=lerobot_libero_plus&task=${encodeURIComponent(detail.base_task.task_key)}`}
              >
                Plus training records
              </Link>
            </Button>
          </div>
          <p>
            <strong className="text-base-content">Source:</strong>{" "}
            {detail.provenance_source.repository}@{detail.provenance_source.revision.slice(0, 12)}
          </p>
          <p className="mt-1">
            The interactive scene reconstructs the official simulator&apos;s initial state; it is
            not an evaluation video or a successful trajectory. Three.js and MuJoCo are different
            renderers, so this view is not claimed to be pixel-identical.
          </p>
        </section>
      </div>
    </article>
  );
}

export default function EvaluationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const suite = searchParams.get("suite") ?? "all";
  const baseTask = searchParams.get("base_task") ?? "all";
  const category = searchParams.get("category");
  const difficulty = searchParams.get("difficulty");
  const selectedCondition = searchParams.get("condition");
  const offset = parseOffset(searchParams.get("offset"));
  const [draft, setDraft] = useState(query);
  const [searchFocused, setSearchFocused] = useState(false);
  const mobileOpen = searchParams.get("sheet") === "condition";
  const desktopWorkspace = useDesktopWorkspace(1536);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [taskCuesEnabled, setTaskCuesEnabled] = useState(true);
  const setParams = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      router.replace(`/evaluation${next.size ? `?${next}` : ""}`, { scroll: false });
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
        setParams({ q: draft.trim() || null, condition: null, offset: null });
    }, 220);
    return () => clearTimeout(timer);
  }, [draft, query, setParams]);
  useEffect(() => {
    const updates: Record<string, string | null> = {};
    const sheet = searchParams.get("sheet");
    if (sheet && sheet !== "condition") updates.sheet = null;
    if (suite !== "all" && !(suite in suiteLabels)) updates.suite = null;
    if (category && !allowedEvaluationCategories.has(category)) updates.category = null;
    if (difficulty && !["1", "2", "3", "4", "5", "unassigned"].includes(difficulty))
      updates.difficulty = null;
    const rawOffset = searchParams.get("offset");
    if (rawOffset && parseOffset(rawOffset) === 0) updates.offset = null;
    if (Object.keys(updates).length) setParams(updates);
  }, [category, difficulty, searchParams, setParams, suite]);
  const scope = new URLSearchParams();
  if (query) scope.set("q", query);
  if (suite !== "all") scope.set("suite", suite);
  if (baseTask !== "all") scope.set("base_task_key", baseTask);
  const summary = useQuery({
    queryKey: ["evaluation-summary", scope.toString()],
    queryFn: () => api<EvaluationSummary>(`/evaluation/summary?${scope}`),
  });
  const families = useQuery({
    queryKey: ["evaluation-base-tasks"],
    queryFn: () => api<Page<TaskFamily>>("/task-families?plus_source=true&limit=130"),
  });
  const conditionParams = new URLSearchParams(scope);
  if (category) conditionParams.set("category", category);
  if (difficulty === "unassigned") conditionParams.set("difficulty_unassigned", "true");
  else if (difficulty && /^[1-5]$/.test(difficulty)) conditionParams.set("difficulty", difficulty);
  conditionParams.set("limit", String(PAGE_SIZE));
  conditionParams.set("offset", String(offset));
  const conditions = useQuery({
    queryKey: ["evaluation-conditions", conditionParams.toString()],
    queryFn: () => api<Page<EvaluationCondition>>(`/evaluation/conditions?${conditionParams}`),
  });
  useEffect(() => {
    if (!conditions.isSuccess || !offset) return;
    const total = conditions.data.total;
    const canonicalOffset = total ? Math.floor((total - 1) / PAGE_SIZE) * PAGE_SIZE : 0;
    if (offset >= total)
      setParams({ offset: canonicalOffset ? String(canonicalOffset) : null, condition: null });
  }, [conditions.data, conditions.isSuccess, offset, setParams]);
  const effectiveCondition = selectedCondition ?? conditions.data?.items[0]?.task_key ?? null;
  const visibleCondition = conditions.data?.items.find(
    (item) => item.task_key === effectiveCondition,
  );
  useEffect(() => {
    if (conditions.data && effectiveCondition && !selectedCondition)
      setParams({ condition: effectiveCondition });
  }, [conditions.data, effectiveCondition, selectedCondition, setParams]);
  const detail = useQuery({
    queryKey: ["evaluation-condition", effectiveCondition],
    queryFn: () =>
      api<EvaluationConditionDetail>(
        `/evaluation/conditions/${encodeURIComponent(effectiveCondition ?? "")}`,
      ),
    enabled: Boolean(effectiveCondition),
  });
  const scene = useQuery({
    queryKey: ["evaluation-condition-scene", effectiveCondition],
    queryFn: () =>
      api<EvaluationSceneRecord>(
        `/evaluation/conditions/${encodeURIComponent(effectiveCondition ?? "")}/scene`,
      ),
    enabled: Boolean(effectiveCondition),
    placeholderData: (previous) =>
      previous?.condition.base_task_key ===
      (visibleCondition?.base_task_key ?? detail.data?.base_task_key)
        ? previous
        : undefined,
  });
  const parsedDefinition = useMemo(
    () => (detail.data ? parseTaskDefinition(detail.data.bddl) : null),
    [detail.data],
  );
  const cueResolution = useMemo(() => {
    if (parsedDefinition?.status !== "parsed" || !scene.data) return null;
    return resolveTaskCues(
      parsedDefinition.definition,
      scene.data.snapshot.bodies.map((body) => body.name),
    );
  }, [parsedDefinition, scene.data]);
  useEffect(() => {
    const selected = detail.data;
    if (!selected || !selectedCondition) return;
    const difficultyMatches =
      !difficulty ||
      (difficulty === "unassigned"
        ? selected.difficulty == null
        : selected.difficulty === Number(difficulty));
    const queryMatches =
      !query ||
      [selected.task_key, selected.name, selected.instruction].some((value) =>
        value.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      );
    if (
      (category && selected.category !== category) ||
      !difficultyMatches ||
      (suite !== "all" && selected.suite !== suite) ||
      (baseTask !== "all" && selected.base_task_key !== baseTask) ||
      !queryMatches
    )
      setParams({ condition: null });
  }, [baseTask, category, detail.data, difficulty, query, selectedCondition, setParams, suite]);
  if (summary.isError || conditions.isError || families.isError || detail.isError)
    return (
      <ErrorPanel error={summary.error ?? conditions.error ?? families.error ?? detail.error} />
    );
  const matrix = summary.data ? (
    <EvaluationMatrix
      summary={summary.data}
      selectedCategory={category}
      selectedDifficulty={difficulty}
      onSelect={(nextCategory, nextDifficulty) =>
        setParams({
          category: nextCategory,
          difficulty: nextDifficulty,
          condition: null,
          offset: null,
        })
      }
      onReset={() => setParams({ category: null, difficulty: null, condition: null, offset: null })}
    />
  ) : (
    <Skeleton className="m-3 h-72" />
  );
  const list = (
    <ConditionList
      page={conditions.data}
      selected={effectiveCondition}
      testId="evaluation-condition-list-desktop"
      onSelect={(key) => setParams({ condition: key })}
      onPage={(value) => setParams({ offset: value ? String(value) : null, condition: null })}
    />
  );
  const scenePane = scene.isError ? (
    <div className="grid h-full place-items-center p-4">
      <ErrorPanel title="Unable to load the official initial scene" error={scene.error} />
    </div>
  ) : scene.data ? (
    <EvaluationSceneViewport
      record={scene.data}
      taskCueBodies={cueResolution?.status === "resolved" ? cueResolution.bodies : []}
      taskCuesEnabled={taskCuesEnabled}
      onTaskCuesEnabledChange={setTaskCuesEnabled}
      updating={scene.isFetching}
    />
  ) : (
    <div className="h-full bg-[#111411] p-4">
      <Skeleton className="size-full bg-white/8" />
    </div>
  );
  const inspector = (
    <ConditionInspector
      detail={detail.data}
      scene={scene.data}
      cueResolution={cueResolution}
      taskCuesEnabled={taskCuesEnabled}
    />
  );
  return (
    <div className="viewport-page flex min-h-0 flex-col gap-2">
      <header className="flex shrink-0 flex-wrap items-center gap-2">
        <label htmlFor="evaluation-condition-search" className="relative min-w-64 flex-1">
          <span className="sr-only">Search evaluation conditions</span>
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40"
            size={15}
          />
          <Input
            id="evaluation-condition-search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Search source instructions or condition IDs"
            className="w-full pl-9"
          />
        </label>
        <Select
          aria-label="Evaluation suite"
          value={suite}
          onChange={(event) =>
            setParams({
              suite: event.target.value === "all" ? null : event.target.value,
              condition: null,
              offset: null,
            })
          }
        >
          <option value="all">All 4 suites</option>
          {Object.entries(suiteLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Source task"
          value={baseTask}
          onChange={(event) =>
            setParams({
              base_task: event.target.value === "all" ? null : event.target.value,
              condition: null,
              offset: null,
            })
          }
          className="max-w-80"
        >
          <option value="all">All 40 source tasks</option>
          {families.data?.items.map((item) => (
            <option key={item.task_key} value={item.task_key}>
              {suiteLabels[item.suite]} #{item.suite_id} · {item.instruction}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          variant="secondary"
          className="2xl:hidden"
          onClick={() => setFiltersOpen(true)}
        >
          <Filter size={14} /> Filters
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <Link href="/sources?source=libero_plus_evaluation_definitions">
            <Database size={14} /> Source
          </Link>
        </Button>
      </header>
      <section className="min-h-0 flex-1 overflow-hidden border border-base-300 bg-base-100">
        {desktopWorkspace ? (
          <div className="h-full min-h-0">
            <Group
              orientation="horizontal"
              className="h-full min-h-0"
              id="evaluation-layout"
              defaultLayout={{ matrix: 17, conditions: 21, scene: 38, inspector: 24 }}
            >
              <Panel id="matrix" defaultSize="17%" minSize={246} maxSize={360}>
                {matrix}
              </Panel>
              <Separator className="group relative w-px bg-base-300">
                <span className="absolute inset-y-0 -left-1.5 w-3 cursor-col-resize group-hover:bg-primary/10" />
              </Separator>
              <Panel id="conditions" defaultSize="21%" minSize={286} maxSize={510}>
                {list}
              </Panel>
              <Separator className="group relative w-px bg-base-300">
                <span className="absolute inset-y-0 -left-1.5 w-3 cursor-col-resize group-hover:bg-primary/10" />
              </Separator>
              <Panel id="scene" defaultSize="38%" minSize={440}>
                {scenePane}
              </Panel>
              <Separator className="group relative w-px bg-base-300">
                <span className="absolute inset-y-0 -left-1.5 w-3 cursor-col-resize group-hover:bg-primary/10" />
              </Separator>
              <Panel id="inspector" defaultSize="24%" minSize={290} maxSize={520}>
                {inspector}
              </Panel>
            </Group>
          </div>
        ) : (
          <div className="h-full">
            <ConditionList
              page={conditions.data}
              selected={effectiveCondition}
              testId="evaluation-condition-list-mobile"
              onSelect={(key) => {
                setParams({ condition: key, sheet: "condition" });
              }}
              onPage={(value) =>
                setParams({ offset: value ? String(value) : null, condition: null })
              }
            />
          </div>
        )}
      </section>
      <Dialog.Root open={!desktopWorkspace && filtersOpen} onOpenChange={setFiltersOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/45 2xl:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-[71] w-[min(25rem,calc(100vw-1rem))] overflow-hidden border-r border-base-300 bg-base-100 2xl:hidden">
            <Dialog.Title className="sr-only">Evaluation filters</Dialog.Title>
            <Dialog.Description className="sr-only">
              Filter by category and difficulty
            </Dialog.Description>
            <Dialog.Close asChild>
              <IconButton
                aria-label="Close filters"
                variant="ghost"
                className="absolute right-2 top-2 z-10"
              >
                <X size={16} />
              </IconButton>
            </Dialog.Close>
            {matrix}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={mobileOpen && !desktopWorkspace}
        onOpenChange={(open) => {
          setParams({ sheet: open ? "condition" : null });
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/45 2xl:hidden" />
          <Dialog.Content className="fixed inset-x-0 bottom-0 z-[71] h-[94dvh] overflow-hidden rounded-t-xl border border-base-300 bg-base-100 2xl:hidden">
            <Dialog.Title className="sr-only">Evaluation condition details</Dialog.Title>
            <Dialog.Description className="sr-only">
              Source-task diff and success predicate
            </Dialog.Description>
            <Dialog.Close asChild>
              <IconButton
                aria-label="Close condition details"
                variant="ghost"
                className="absolute right-3 top-3 z-10"
              >
                <X size={16} />
              </IconButton>
            </Dialog.Close>
            <div className="grid size-full min-h-0 grid-rows-[minmax(18rem,48%)_minmax(0,1fr)] pt-11 lg:grid-cols-[minmax(0,3fr)_minmax(22rem,2fr)] lg:grid-rows-1 lg:pt-0">
              <div className="min-h-0 border-b border-base-300 lg:border-b-0 lg:border-r">
                {scenePane}
              </div>
              <div className="min-h-0">{inspector}</div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
