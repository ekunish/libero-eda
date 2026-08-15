import { tableFromIPC } from "apache-arrow";
import { z } from "zod";
import type {
  DataSourceRegistry,
  EpisodeRecord,
  EvaluationCondition,
  EvaluationConditionDetail,
  EvaluationSummary,
  Page,
  RecordingDatasetId,
  ReplayContext,
  ReplayContextItem,
  ReplayManifest,
  ReplaySeries,
  TaskDetail,
  TaskEpisodes,
  TaskFamily,
  TrainingEnvironmentCategories,
} from "./contracts";
import { validateHostedManifestUrl } from "./manifest-url";

const DEFAULT_MANIFEST_URL =
  "https://huggingface.co/datasets/ekunish/libero-eda-data/resolve/a7794c387bc595be3b54e8c4ac8eda0e7c49a752/manifest.json";
const manifestUrl = validateHostedManifestUrl(
  process.env.NEXT_PUBLIC_LIBERO_EDA_DATA_MANIFEST ?? DEFAULT_MANIFEST_URL,
);

const manifestSchema = z.object({
  schema_version: z.literal("libero-eda-hosted/v1"),
  revision: z.string().min(1),
  generated_at: z.string().min(1),
  catalog: z.object({
    tasks: z.string().min(1),
    episodes: z.string().min(1),
    sources: z.string().min(1),
  }),
  evaluation: z.object({
    repository: z.literal("sylvestf/LIBERO-plus"),
    revision: z.string().regex(/^[0-9a-f]{40}$/),
    classification_url: z.string().url(),
    bddl_base_url: z.string().url(),
  }),
  counts: z.object({
    task_families: z.literal(130),
    original_episodes: z.literal(6500),
    plus_training_episodes: z.literal(14347),
    evaluation_conditions: z.literal(10030),
  }),
  integrity: z.object({
    index: z.literal("integrity/artifacts.json"),
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    artifact_count: z.number().int().positive(),
    artifact_bytes: z.number().int().positive(),
  }),
});

type HostedManifest = z.infer<typeof manifestSchema>;
type HostedCatalog = {
  families: TaskFamily[];
  details: Record<string, TaskDetail>;
  task_shards: Record<string, string>;
  replay_tasks: Record<string, string>;
};
type HostedEpisode = {
  record: EpisodeRecord;
  manifest: ReplayManifest;
};
type HostedTaskShard = {
  task_key: string;
  datasets: Record<RecordingDatasetId, HostedEpisode[]>;
};
type EvaluationRaw = Record<
  string,
  Array<{ id: number; name: string; category: string; difficulty_level: number | null }>
>;

let manifestPromise: Promise<HostedManifest> | undefined;
let catalogPromise: Promise<HostedCatalog> | undefined;
let episodeIndexPromise: Promise<EpisodeRecord[]> | undefined;
let sourcePromise: Promise<DataSourceRegistry> | undefined;
let evaluationPromise: Promise<EvaluationCondition[]> | undefined;
const shardPromises = new Map<string, Promise<HostedTaskShard>>();
const bddlPromises = new Map<string, Promise<string>>();

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail: unknown,
  ) {
    super(message);
  }
}

declare global {
  var __LIBERO_EDA_MOCK_API__: boolean | undefined;
}

async function mockApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, init);
  if (!response.ok)
    throw new ApiError(
      `Mock API request failed: ${response.status}`,
      response.status,
      await response.text(),
    );
  return (await response.json()) as T;
}

async function checkedJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok)
    throw new ApiError(`Data request failed: ${response.status}`, response.status, url);
  return (await response.json()) as T;
}

async function manifest(): Promise<HostedManifest> {
  manifestPromise ??= checkedJson<unknown>(manifestUrl).then((value) =>
    manifestSchema.parse(value),
  );
  return manifestPromise;
}

function resolveFrom(base: string, path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const origin = globalThis.location?.origin ?? "http://127.0.0.1";
  return new URL(path, new URL(base, origin)).toString();
}

async function dataUrl(path: string): Promise<string> {
  await manifest();
  return resolveFrom(manifestUrl, path);
}

function staticDataUrl(path: string): string {
  return resolveFrom(manifestUrl, path);
}

function replayAssetPath(kind: "series" | "thumbnails", replayId: string, suffix: string): string {
  if (replayId.startsWith("demo-")) {
    const episode = Number(replayId.slice(5));
    if (!Number.isSafeInteger(episode) || episode < 0) {
      throw new ApiError("Invalid LIBERO-Plus replay id", 409, replayId);
    }
    return `assets/${kind}/lerobot_libero_plus/chunk-${String(Math.floor(episode / 1000)).padStart(3, "0")}/${replayId}${suffix}`;
  }
  const match = replayId.match(/^original-libero-(.+)-(\d{3})-(\d{2})$/);
  if (!match?.[1] || !match[2])
    throw new ApiError("Invalid Original LIBERO replay id", 409, replayId);
  return `assets/${kind}/original_libero/${match[1]}/${match[2]}/${replayId}${suffix}`;
}

async function catalog(): Promise<HostedCatalog> {
  catalogPromise ??= manifest().then(async (value) => {
    const result = await checkedJson<HostedCatalog>(await dataUrl(value.catalog.tasks));
    if (
      result.families.length !== value.counts.task_families ||
      Object.keys(result.details).length !== value.counts.task_families ||
      Object.keys(result.task_shards).length !== value.counts.task_families ||
      Object.keys(result.replay_tasks).length !==
        value.counts.original_episodes + value.counts.plus_training_episodes
    ) {
      throw new ApiError("Hosted task catalog count mismatch", 409, null);
    }
    return result;
  });
  return catalogPromise;
}

async function episodeIndex(): Promise<EpisodeRecord[]> {
  episodeIndexPromise ??= manifest().then(async (value) => {
    const result = await checkedJson<EpisodeRecord[]>(await dataUrl(value.catalog.episodes));
    const original = result.filter((item) => item.dataset_id === "original_libero").length;
    const plus = result.filter((item) => item.dataset_id === "lerobot_libero_plus").length;
    if (
      original !== value.counts.original_episodes ||
      plus !== value.counts.plus_training_episodes
    ) {
      throw new ApiError("Hosted episode index count mismatch", 409, { original, plus });
    }
    return result;
  });
  return episodeIndexPromise;
}

async function sources(): Promise<DataSourceRegistry> {
  sourcePromise ??= manifest().then(async (value) => {
    const result = await checkedJson<DataSourceRegistry>(await dataUrl(value.catalog.sources));
    if (
      result.groups.some((group) =>
        group.sources.some((source) => source.source_id.includes("track1")),
      )
    ) {
      throw new ApiError("Competition-specific source found in public registry", 409, null);
    }
    return result;
  });
  return sourcePromise;
}

async function taskShard(taskKey: string): Promise<HostedTaskShard> {
  const existing = shardPromises.get(taskKey);
  if (existing) return existing;
  const promise = catalog().then(async (value) => {
    const path = value.task_shards[taskKey];
    if (!path) throw new ApiError("Task shard not found", 404, taskKey);
    const shard = await checkedJson<HostedTaskShard>(await dataUrl(path));
    if (shard.task_key !== taskKey)
      throw new ApiError("Task shard identity mismatch", 409, taskKey);
    return shard;
  });
  shardPromises.set(taskKey, promise);
  return promise;
}

async function hostedEpisode(replayId: string): Promise<HostedEpisode> {
  const taskKey = (await catalog()).replay_tasks[replayId];
  if (!taskKey) throw new ApiError("Replay not found", 404, replayId);
  const shard = await taskShard(taskKey);
  for (const episodes of Object.values(shard.datasets)) {
    const episode = episodes.find((item) => item.record.replay_id === replayId);
    if (episode) return episode;
  }
  throw new ApiError("Replay index is inconsistent", 409, replayId);
}

function parseNumber(value: string | null, fallback: number): number {
  if (value == null) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function page<T>(items: T[], params: URLSearchParams): Page<T> {
  const limit = Math.max(1, Math.min(500, parseNumber(params.get("limit"), 100)));
  const offset = parseNumber(params.get("offset"), 0);
  return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
}

function matchesQuery(
  values: Array<string | number | null | undefined>,
  query: string | null,
): boolean {
  const normalized = query?.trim().toLocaleLowerCase();
  return (
    !normalized ||
    values.some((value) =>
      String(value ?? "")
        .toLocaleLowerCase()
        .includes(normalized),
    )
  );
}

function withoutTrack1<
  T extends { is_t1: boolean; t1_ordinal: number | null; t1_instruction: string | null },
>(item: T): T {
  return { ...item, is_t1: false, t1_ordinal: null, t1_instruction: null };
}

async function taskFamilies(params: URLSearchParams): Promise<Page<TaskFamily>> {
  const value = await catalog();
  const q = params.get("q");
  const suite = params.get("suite");
  const plusOnly = params.get("plus_source") === "true";
  const filtered = value.families
    .filter((item) => !suite || item.suite === suite)
    .filter((item) => !plusOnly || item.is_plus_source)
    .filter((item) => matchesQuery([item.task_key, item.name, item.instruction], q))
    .map((item) => ({ ...item, t1_variant_count: 0, t1_ordinals: [] }));
  return page(filtered, params);
}

function bddlStem(condition: EvaluationCondition): string {
  if (
    ["Camera Viewpoints", "Robot Initial States", "Sensor Noise"].includes(condition.category ?? "")
  ) {
    return condition.base_task.name;
  }
  if (condition.category === "Language Instructions") {
    return condition.name.replace(
      /_view_-?\d+_-?\d+_-?\d+_-?\d+_-?\d+_initstate_\d+(?:_noise_\d+)?$/,
      "",
    );
  }
  return condition.name;
}

async function bddlFor(condition: EvaluationCondition): Promise<string> {
  const key = `${condition.suite}/${bddlStem(condition)}`;
  const existing = bddlPromises.get(key);
  if (existing) return existing;
  const promise = manifest().then(async (value) => {
    const url = `${value.evaluation.bddl_base_url.replace(/\/$/, "")}/${encodeURIComponent(condition.suite)}/${encodeURIComponent(bddlStem(condition))}.bddl`;
    const response = await fetch(url, { headers: { Accept: "text/plain" } });
    if (!response.ok)
      throw new ApiError(`Official BDDL request failed: ${response.status}`, response.status, url);
    return response.text();
  });
  bddlPromises.set(key, promise);
  return promise;
}

function instructionFromBddl(text: string): string {
  const match = text.match(/\(:language\s+([^\r\n)]+)\)/);
  if (!match?.[1]?.trim())
    throw new ApiError("Official BDDL has no language instruction", 409, null);
  return match[1].trim();
}

async function evaluationConditions(): Promise<EvaluationCondition[]> {
  evaluationPromise ??= Promise.all([manifest(), catalog()]).then(async ([hosted, tasks]) => {
    const raw = await checkedJson<EvaluationRaw>(hosted.evaluation.classification_url);
    const bases = tasks.families
      .filter((item) => item.is_plus_source)
      .sort((a, b) => b.name.length - a.name.length);
    const result: EvaluationCondition[] = [];
    for (const [suite, rows] of Object.entries(raw)) {
      for (const row of rows) {
        const base = bases.find((item) => item.suite === suite && row.name.startsWith(item.name));
        if (!base)
          throw new ApiError("Evaluation condition has no source task", 409, {
            suite,
            id: row.id,
            name: row.name,
          });
        result.push({
          task_key: `plus:${suite}:${row.id}`,
          source: "libero_plus",
          suite,
          suite_id: row.id,
          name: row.name,
          instruction: base.instruction,
          base_task_key: base.task_key,
          plus_task_key: null,
          category: row.category,
          difficulty: row.difficulty_level,
          scene: base.scene,
          is_t1: false,
          t1_ordinal: null,
          t1_instruction: null,
          entry_kind: "changed_variant",
          base_task: {
            task_key: base.task_key,
            suite: base.suite,
            suite_id: base.suite_id,
            name: base.name,
            instruction: base.instruction,
          },
        });
      }
    }
    if (result.length !== hosted.counts.evaluation_conditions) {
      throw new ApiError("Official evaluation count mismatch", 409, result.length);
    }
    return result;
  });
  return evaluationPromise;
}

function filterEvaluation(
  items: EvaluationCondition[],
  params: URLSearchParams,
): EvaluationCondition[] {
  const q = params.get("q");
  const suite = params.get("suite");
  const category = params.get("category");
  const base = params.get("base_task_key");
  const difficulty = params.get("difficulty");
  const unassigned = params.get("difficulty_unassigned") === "true";
  return items
    .filter((item) => !suite || item.suite === suite)
    .filter((item) => !category || item.category === category)
    .filter((item) => !base || item.base_task_key === base)
    .filter((item) => !difficulty || item.difficulty === Number(difficulty))
    .filter((item) => !unassigned || item.difficulty == null)
    .filter((item) => matchesQuery([item.task_key, item.name, item.base_task.instruction], q));
}

function evaluationSummary(items: EvaluationCondition[]): EvaluationSummary {
  const cells = new Map<string, { category: string; difficulty: number | null; count: number }>();
  const suites = new Map<string, number>();
  for (const item of items) {
    const key = `${item.category}:${item.difficulty ?? "null"}`;
    const cell = cells.get(key) ?? {
      category: item.category ?? "",
      difficulty: item.difficulty,
      count: 0,
    };
    cell.count += 1;
    cells.set(key, cell);
    suites.set(item.suite, (suites.get(item.suite) ?? 0) + 1);
  }
  return {
    total_conditions: items.length,
    source_task_count: new Set(items.map((item) => item.base_task_key)).size,
    matrix: [...cells.values()].sort(
      (a, b) => a.category.localeCompare(b.category) || (a.difficulty ?? 99) - (b.difficulty ?? 99),
    ),
    suites: [...suites]
      .map(([suite, count]) => ({ suite, count }))
      .sort((a, b) => a.suite.localeCompare(b.suite)),
    categories: [...new Set(items.map((item) => item.category ?? ""))].sort(),
    difficulty_levels: [1, 2, 3, 4, 5],
    unassigned_difficulty_count: items.filter((item) => item.difficulty == null).length,
  };
}

async function evaluationDetail(taskKey: string): Promise<EvaluationConditionDetail> {
  const condition = (await evaluationConditions()).find((item) => item.task_key === taskKey);
  if (!condition) throw new ApiError("Evaluation condition not found", 404, taskKey);
  const bddl = await bddlFor(condition);
  const base = (await catalog()).details[condition.base_task_key ?? ""];
  if (!base) throw new ApiError("Evaluation source task not found", 409, taskKey);
  const goalMatch = bddl.match(/\(:goal\s+([\s\S]*?)\n\s*\)\s*\)\s*$/);
  const hosted = await manifest();
  return {
    ...condition,
    instruction: instructionFromBddl(bddl),
    bddl,
    bddl_diff: bddl === base.bddl ? "" : `--- ${base.task_key}\n+++ ${condition.task_key}\n`,
    definition_relation: bddl === base.bddl ? "same_text" : "changed",
    lineage_root_key: base.task_key,
    related_total: 1,
    related: [],
    base_task: {
      task_key: base.task_key,
      suite: base.suite,
      suite_id: base.suite_id,
      name: base.name,
      instruction: base.instruction,
      scene: base.scene,
    },
    goal_expression: goalMatch?.[1]?.trim() ?? null,
    provenance_source: {
      repository: hosted.evaluation.repository,
      revision: hosted.evaluation.revision,
      task_key: condition.task_key,
    },
  };
}

async function taskEpisodes(taskKey: string, params: URLSearchParams): Promise<TaskEpisodes> {
  const data = await catalog();
  const family = data.families.find((item) => item.task_key === taskKey);
  if (!family) throw new ApiError("Task not found", 404, taskKey);
  const dataset = (params.get("dataset_id") ?? "lerobot_libero_plus") as RecordingDatasetId;
  if (!(["original_libero", "lerobot_libero_plus"] as string[]).includes(dataset)) {
    throw new ApiError("Unknown recorded dataset", 422, dataset);
  }
  const records = (await taskShard(taskKey)).datasets[dataset] ?? [];
  const category = params.get("training_environment_category");
  const filtered = records
    .map((item) => item.record)
    .filter((item) => !category || item.training_environment_category === category);
  const paged = page(filtered, params);
  const available = !(dataset === "lerobot_libero_plus" && family.suite === "libero_90");
  return {
    ...paged,
    dataset_id: dataset,
    dataset_name:
      dataset === "original_libero"
        ? "Original LIBERO official demonstrations"
        : "LIBERO-Plus training trajectories",
    availability: available ? "available" : "not_in_dataset",
    relationship: available ? "recorded_for_task" : "none",
    requested_task: {
      task_key: family.task_key,
      source: "libero",
      suite: family.suite,
      suite_id: family.suite_id,
      name: family.name,
      instruction: family.instruction,
      base_task_key: null,
      category: null,
      difficulty: null,
    },
    recorded_task_key: available ? family.task_key : null,
    lineage_task_key: family.task_key,
  };
}

async function trainingCategories(taskKey: string | null): Promise<TrainingEnvironmentCategories> {
  const records = taskKey
    ? (await taskShard(taskKey)).datasets.lerobot_libero_plus.map((item) => item.record)
    : (await episodeIndex()).filter((item) => item.dataset_id === "lerobot_libero_plus");
  const counts = new Map<string, number>();
  const relations = new Map<string, number>();
  for (const item of records) {
    if (item.training_environment_category)
      counts.set(
        item.training_environment_category,
        (counts.get(item.training_environment_category) ?? 0) + 1,
      );
    relations.set(
      item.training_instruction_relation,
      (relations.get(item.training_instruction_relation) ?? 0) + 1,
    );
  }
  return {
    dataset_id: "lerobot_libero_plus",
    display_name: "LIBERO-Plus training trajectories",
    source_namespace: "official_rlds_episode_metadata.file_path",
    base_task_key: taskKey,
    strength_availability: "not_published",
    items: [...counts]
      .map(([category, episode_count]) => ({ category, episode_count }))
      .sort((a, b) => a.category.localeCompare(b.category)),
    training_instruction: {
      availability: "published",
      source_feature: "official_rlds.steps/language_instruction",
    },
    training_instruction_relations: [...relations].map(([relation, episode_count]) => ({
      relation:
        relation as TrainingEnvironmentCategories["training_instruction_relations"][number]["relation"],
      episode_count,
    })),
  };
}

function contextItem(item: HostedEpisode): ReplayContextItem {
  return {
    replay_id: item.record.replay_id,
    source: "dataset",
    dataset_id: item.record.dataset_id,
    run_id: null,
    source_episode_id: item.record.source_episode_id,
    task_key: item.record.base_task_key,
    task_name: item.record.task_instruction,
    original_task_instruction: item.record.original_task_instruction,
    episode_id: item.record.episode_index,
    init_index: null,
    state_count: item.manifest.state_count,
    fps: item.manifest.fps,
    duration_sec: item.record.duration_sec,
    outcome: item.manifest.outcome,
    training_environment_category: item.record.training_environment_category,
    training_instruction: item.record.training_instruction,
    training_instruction_source: item.record.training_instruction_source,
    training_instruction_availability: item.record.training_instruction_availability,
    training_instruction_relation: item.record.training_instruction_relation,
  };
}

async function replayContext(replayId: string, params: URLSearchParams): Promise<ReplayContext> {
  const current = await hostedEpisode(replayId);
  const scope = params.get("scope") ?? "auto";
  if (!["auto", "task", "dataset"].includes(scope))
    throw new ApiError("Hosted replay scope must be task or dataset", 422, scope);
  const shard = await taskShard(current.record.base_task_key);
  let items =
    scope === "dataset"
      ? (
          await Promise.all(Object.keys((await catalog()).task_shards).map((key) => taskShard(key)))
        ).flatMap((entry) => entry.datasets[current.record.dataset_id] ?? [])
      : (shard.datasets[current.record.dataset_id] ?? []);
  const q = params.get("q")?.trim() || null;
  const category = params.get("training_environment_category")?.trim() || null;
  items = items
    .filter((item) =>
      matchesQuery(
        [item.record.replay_id, item.record.source_episode_id, item.record.task_instruction],
        q,
      ),
    )
    .filter((item) => !category || item.record.training_environment_category === category);
  const position = items.findIndex((item) => item.record.replay_id === replayId);
  const limit = Math.max(1, Math.min(200, parseNumber(params.get("limit"), 50)));
  const requestedOffset = params.has("offset")
    ? parseNumber(params.get("offset"), 0)
    : position >= 0
      ? Math.floor(position / limit) * limit
      : 0;
  const maxOffset = items.length ? Math.floor((items.length - 1) / limit) * limit : 0;
  const offset = Math.min(requestedOffset, maxOffset);
  const currentIndex = position >= 0 ? position : null;
  const family = (await catalog()).families.find(
    (item) => item.task_key === current.record.base_task_key,
  );
  return {
    scope: {
      kind: scope === "dataset" ? "dataset" : "task",
      label:
        scope === "dataset"
          ? current.record.dataset_id === "original_libero"
            ? "Original LIBERO official demonstrations"
            : "LIBERO-Plus training trajectories"
          : (family?.instruction ?? current.record.task_instruction),
      dataset_id: current.record.dataset_id,
      run_id: null,
      task_key: scope === "dataset" ? null : current.record.base_task_key,
    },
    filters: { q, training_environment_category: category, outcome: null },
    items: items.slice(offset, offset + limit).map(contextItem),
    total: items.length,
    limit,
    offset,
    current_index: currentIndex,
    previous_replay_id: position > 0 ? (items[position - 1]?.record.replay_id ?? null) : null,
    next_replay_id:
      position >= 0 && position + 1 < items.length
        ? (items[position + 1]?.record.replay_id ?? null)
        : null,
  };
}

function decodeShape(flat: number[], shape: number[]): unknown[] {
  if (shape.length <= 1) return flat;
  const width = shape.slice(1).reduce((product, value) => product * value, 1);
  return Array.from({ length: shape[0] ?? 0 }, (_, index) =>
    decodeShape(flat.slice(index * width, (index + 1) * width), shape.slice(1)),
  );
}

async function replaySeries(replayId: string): Promise<ReplaySeries> {
  if (!("DecompressionStream" in globalThis))
    throw new ApiError("This browser cannot decode hosted gzip series", 409, null);
  const response = await fetch(staticDataUrl(replayAssetPath("series", replayId, ".arrow.gz")));
  if (!response.ok || !response.body)
    throw new ApiError(`Series request failed: ${response.status}`, response.status, replayId);
  const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
  const ipc = await new Response(stream).arrayBuffer();
  const table = tableFromIPC(new Uint8Array(ipc));
  const shapesRaw = table.getChild("shapes")?.get(0);
  if (typeof shapesRaw !== "string")
    throw new ApiError("Series shape metadata is missing", 409, replayId);
  const shapes = JSON.parse(shapesRaw) as Record<string, number[]>;
  const jsonRaw = table.getChild("json")?.get(0);
  const json = typeof jsonRaw === "string" ? (JSON.parse(jsonRaw) as Record<string, unknown>) : {};
  const floats = (name: string): unknown[] => {
    const raw = table.getChild(name)?.get(0);
    if (!(raw instanceof Uint8Array)) return [];
    const values = Array.from(new Float64Array(raw.slice().buffer));
    return decodeShape(values, shapes[name] ?? [values.length]);
  };
  const integers = (name: string): number[] => {
    const raw = table.getChild(name)?.get(0);
    return raw instanceof Uint8Array ? Array.from(new Int32Array(raw.slice().buffer)) : [];
  };
  return {
    schema_version: "parc-series/v2",
    time: floats("time") as number[],
    frame_index: integers("frame_index"),
    ee_positions: floats("ee_positions") as number[][],
    ee_axis_angle: floats("ee_axis_angle") as number[][],
    ee_orientations: floats("ee_orientations") as number[][],
    gripper_qpos: floats("gripper_qpos") as number[][],
    actions: floats("actions") as number[][],
    rewards: floats("rewards") as number[],
    joints: floats("joints") as number[][],
    body_positions: floats("body_positions") as number[][][],
    body_quaternions: floats("body_quaternions") as number[][][],
    qpos: floats("qpos") as number[][],
    qvel: floats("qvel") as number[][],
    object_displacements: (json.object_displacements ?? {}) as Record<string, number[]>,
    chunk_boundaries: integers("chunk_boundaries"),
    speed: floats("speed") as number[],
    acceleration: floats("acceleration") as number[],
    jerk: floats("jerk") as number[],
  };
}

async function dispatch(path: string): Promise<unknown> {
  const url = new URL(path, "https://libero-eda.local");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (url.pathname === "/health") {
    const value = await manifest();
    return {
      status: "ok",
      database_ready: true,
      dataset_ready: true,
      catalog_revision: value.revision,
      issues: [],
    };
  }
  if (url.pathname === "/data-sources") return sources();
  if (url.pathname === "/task-families") return taskFamilies(url.searchParams);
  if (url.pathname === "/datasets/episodes") {
    const dataset = url.searchParams.get("dataset_id") as RecordingDatasetId;
    const all = (await episodeIndex()).filter((item) => item.dataset_id === dataset);
    const q = url.searchParams.get("q");
    return page(
      all.filter((item) =>
        matchesQuery([item.replay_id, item.source_episode_id, item.task_instruction], q),
      ),
      url.searchParams,
    );
  }
  if (url.pathname === "/datasets/lerobot_libero_plus/training-environment-categories") {
    return trainingCategories(url.searchParams.get("base_task_key"));
  }
  if (url.pathname === "/evaluation/summary") {
    const items = filterEvaluation(await evaluationConditions(), url.searchParams);
    return evaluationSummary(items);
  }
  if (url.pathname === "/evaluation/conditions") {
    const filtered = filterEvaluation(await evaluationConditions(), url.searchParams);
    const paged = page(filtered, url.searchParams);
    const withInstructions = await Promise.all(
      paged.items.map(async (item) => ({
        ...item,
        instruction: instructionFromBddl(await bddlFor(item)),
      })),
    );
    return { ...paged, items: withInstructions };
  }
  if (parts[0] === "evaluation" && parts[1] === "conditions" && parts[2])
    return evaluationDetail(parts[2]);
  if (url.pathname === "/tasks")
    return page(filterEvaluation(await evaluationConditions(), url.searchParams), url.searchParams);
  if (parts[0] === "tasks" && parts[1] && parts[2] === "episodes")
    return taskEpisodes(parts[1], url.searchParams);
  if (parts[0] === "tasks" && parts[1]) {
    const detail = (await catalog()).details[parts[1]];
    if (!detail) throw new ApiError("Task not found", 404, parts[1]);
    return withoutTrack1(detail);
  }
  if (parts[0] === "replays" && parts[1] && parts[2] === "series") return replaySeries(parts[1]);
  if (parts[0] === "replays" && parts[1] && parts[2] === "context")
    return replayContext(parts[1], url.searchParams);
  if (parts[0] === "replays" && parts[1]) return (await hostedEpisode(parts[1])).manifest;
  throw new ApiError("Hosted endpoint not found", 404, url.pathname);
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (globalThis.__LIBERO_EDA_MOCK_API__ === true) return mockApi<T>(path, init);
  const method = init?.method?.toUpperCase() ?? "GET";
  if (method !== "GET") throw new ApiError("Hosted LIBERO EDA is read-only", 405, method);
  return (await dispatch(path)) as T;
}

export function mediaUrl(assetId: string): string {
  if (globalThis.__LIBERO_EDA_MOCK_API__ === true) {
    return `/api/v1/media/${encodeURIComponent(assetId)}`;
  }
  return /^https?:\/\//.test(assetId) ? assetId : staticDataUrl(assetId);
}

export function replayThumbnailUrl(replayId: string): string {
  if (globalThis.__LIBERO_EDA_MOCK_API__ === true) {
    return `/api/v1/replays/${encodeURIComponent(replayId)}/thumbnail`;
  }
  return staticDataUrl(replayAssetPath("thumbnails", replayId, ".webp"));
}
