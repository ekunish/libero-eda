"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Database, FileDiff, Filter, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  api,
  type EvaluationCondition,
  type EvaluationConditionDetail,
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

function ConditionDetail({ detail }: { detail: EvaluationConditionDetail | undefined }) {
  if (!detail)
    return (
      <div className="grid h-full place-items-center text-sm text-base-content/55">
        Select an evaluation condition.
      </div>
    );
  const languageChanged = detail.category === "Language Instructions";
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
        <section className="grid gap-px bg-base-300 lg:grid-cols-2">
          <div className="bg-base-100 p-4">
            <h3 className="text-xs font-semibold text-base-content/55">Source task instruction</h3>
            <p className="mt-1 text-sm leading-6">{detail.base_task.instruction}</p>
            <p className="mono mt-1 text-xs text-base-content/45">
              {suiteLabels[detail.base_task.suite]} #{detail.base_task.suite_id}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
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
          </div>
          <div className="bg-base-100 p-4">
            <h3 className="text-xs font-semibold text-base-content/55">
              Instruction used for evaluation
            </h3>
            <p
              className={cn(
                "mt-1 text-sm leading-6",
                languageChanged && "font-semibold text-secondary",
              )}
            >
              {detail.instruction}
            </p>
            <p className="mt-1 text-xs leading-5 text-base-content/50">
              {languageChanged
                ? "This rewritten instruction is passed to the model for this Language condition."
                : "For non-language categories, the primary change is in the environment or observation."}
            </p>
          </div>
        </section>
        <section className="px-4 py-3">
          <h3 className="text-xs font-semibold text-base-content/55">
            Success predicate (BDDL goal)
          </h3>
          <pre className="mono mt-2 overflow-x-auto whitespace-pre-wrap border-l-2 border-success pl-3 text-xs leading-5">
            {detail.goal_expression ?? "Goal expression unavailable"}
          </pre>
        </section>
        <details className="group px-4 py-3">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
            <FileDiff size={14} /> Diff from source task
          </summary>
          <pre className="mono mt-3 max-h-80 overflow-auto whitespace-pre-wrap bg-base-200 p-3 text-xs leading-5">
            {detail.bddl_diff || "No BDDL text diff"}
          </pre>
        </details>
        <details className="group px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold">Full evaluation BDDL</summary>
          <pre className="mono mt-3 max-h-80 overflow-auto whitespace-pre-wrap bg-base-200 p-3 text-xs leading-5">
            {detail.bddl}
          </pre>
        </details>
        <section className="px-4 py-3 text-xs leading-5 text-base-content/60">
          <p>
            <strong className="text-base-content">Source:</strong>{" "}
            {detail.provenance_source.repository}@{detail.provenance_source.revision.slice(0, 12)}
          </p>
          <p className="mt-1">
            Evaluation definitions do not include official videos or successful trajectories. A
            policy is executed in this simulator condition and evaluated against the BDDL goal.
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
  const desktopWorkspace = useDesktopWorkspace();
  const [filtersOpen, setFiltersOpen] = useState(false);
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
          className="xl:hidden"
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
        <div className="hidden h-full min-h-0 xl:block">
          <Group
            orientation="horizontal"
            className="h-full min-h-0"
            id="evaluation-layout"
            defaultLayout={{ matrix: 22, conditions: 29, detail: 49 }}
          >
            <Panel id="matrix" defaultSize="22%" minSize={300} maxSize={390}>
              {matrix}
            </Panel>
            <Separator className="group relative w-px bg-base-300">
              <span className="absolute inset-y-0 -left-1.5 w-3 cursor-col-resize group-hover:bg-primary/10" />
            </Separator>
            <Panel id="conditions" defaultSize="29%" minSize={390} maxSize={620}>
              {list}
            </Panel>
            <Separator className="group relative w-px bg-base-300">
              <span className="absolute inset-y-0 -left-1.5 w-3 cursor-col-resize group-hover:bg-primary/10" />
            </Separator>
            <Panel id="detail" defaultSize="49%" minSize={520}>
              <ConditionDetail detail={detail.data} />
            </Panel>
          </Group>
        </div>
        <div className="h-full xl:hidden">
          <ConditionList
            page={conditions.data}
            selected={effectiveCondition}
            testId="evaluation-condition-list-mobile"
            onSelect={(key) => {
              setParams({ condition: key, sheet: "condition" });
            }}
            onPage={(value) => setParams({ offset: value ? String(value) : null, condition: null })}
          />
        </div>
      </section>
      <Dialog.Root open={filtersOpen} onOpenChange={setFiltersOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/45 xl:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-[71] w-[min(25rem,calc(100vw-1rem))] overflow-hidden border-r border-base-300 bg-base-100 xl:hidden">
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
          <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/45 xl:hidden" />
          <Dialog.Content className="fixed inset-x-0 bottom-0 z-[71] h-[92dvh] overflow-hidden rounded-t-xl border border-base-300 bg-base-100 xl:hidden">
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
            <ConditionDetail detail={detail.data} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
