import { tableFromIPC } from "apache-arrow";
import { z } from "zod";
import type {
  DataSourceRegistry,
  EpisodeRecord,
  EvaluationCondition,
  EvaluationConditionDetail,
  EvaluationSceneRecord,
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
  "https://huggingface.co/datasets/ekunish/libero-eda-data/resolve/cdbeebc91b28f96e8d7e4f79b0ca21094a2675ef/manifest.json";
const manifestUrl = validateHostedManifestUrl(
  process.env.NEXT_PUBLIC_LIBERO_EDA_DATA_MANIFEST ?? DEFAULT_MANIFEST_URL,
);
const relativeArtifactSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !/^https?:/i.test(value) &&
      !value.includes("?") &&
      !value.includes("#") &&
      !value.split("/").includes(".."),
    "Expected a confined relative artifact path",
  );

const manifestSchema = z.object({
  schema_version: z.literal("libero-eda-hosted/v2"),
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
    scene_manifest: relativeArtifactSchema,
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

const finite = z.number().finite();
const vector3 = z.tuple([finite, finite, finite]);
const quaternion = z.tuple([finite, finite, finite, finite]);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const cameraSchema = z.object({
  camera: z.string().min(1),
  position: vector3,
  rotation_matrix: z.tuple([
    finite,
    finite,
    finite,
    finite,
    finite,
    finite,
    finite,
    finite,
    finite,
  ]),
  rotation_matrix_layout: z.literal("row_major"),
  rotation_matrix_convention: z.literal("camera_local_to_world"),
  camera_axis_convention: z.literal("mujoco_camera"),
  vertical_fov_degrees: finite.gt(0).lt(180),
  scope: z.literal("fixed_world"),
  calibration_provenance: z.string().min(1),
});
const lightSchema = z.object({
  index: z.number().int().nonnegative(),
  name: z.string().min(1),
  type: z.enum(["spot", "directional", "point"]),
  mode: z.literal("fixed_world"),
  position: vector3,
  direction: vector3,
  ambient: vector3,
  diffuse: vector3,
  specular: vector3,
  attenuation: vector3,
  cutoff_degrees: finite.min(0).max(90),
  exponent: finite.min(0).max(128),
  active: z.boolean(),
  cast_shadow: z.boolean(),
});
const materialSchema = z.object({
  rgba: z.tuple([finite, finite, finite, finite]),
  emission: finite.min(0).max(1),
  specular: finite.min(0).max(1),
  shininess: finite.min(0).max(1),
  reflectance: finite.min(0).max(1),
  texuniform: z.boolean(),
  texture_type: z.union([z.literal(0), z.literal(1), z.null()]),
  texture_repeat: z.tuple([finite.positive(), finite.positive()]),
  texture_key: z.union([sha256Schema, z.null()]),
});
const sceneSnapshotSchema = z.object({
  schema_version: z.literal("libero-evaluation-scene-snapshot/v1"),
  scene_exporter_revision: z.literal("mujoco-classic-uv3"),
  bodies: z
    .array(z.object({ name: z.string().min(1), translation: vector3, rotation: quaternion }))
    .min(1),
  geoms: z
    .array(
      z.object({
        name: z.string().min(1),
        body: z.string().min(1),
        geometry_key: sha256Schema,
        material_key: sha256Schema,
        translation: vector3,
        rotation: quaternion,
        geom_type: z.number().int().min(0).max(7),
        geom_size: vector3,
        reflective_surface: z.union([
          z.object({ kind: z.enum(["plane", "box_top"]), reflectance: finite.gt(0).max(1) }),
          z.null(),
        ]),
      }),
    )
    .min(1),
  materials: z.record(sha256Schema, materialSchema),
  render: z.object({
    renderer: z.literal("mujoco_classic"),
    color_space: z.literal("srgb_textures_linear_lighting"),
    tone_mapping: z.literal("none"),
    headlight: z.object({
      active: z.boolean(),
      ambient: vector3,
      diffuse: vector3,
      specular: vector3,
    }),
    lights: z.array(lightSchema),
    shadow_map_size: z.number().int().positive(),
    skybox: z.union([
      z.object({
        texture_key: sha256Schema,
        layout: z.literal("vertical_R_L_U_D_F_B"),
        face_size: z.number().int().positive(),
      }),
      z.null(),
    ]),
  }),
  cameras: z.array(cameraSchema),
});
const benchmarkRuntimeSourceSchema = z.union([
  z.object({
    variant: z.literal("upstream"),
    sha256: z.literal("70ed74d8a05cdc0808d0347536781e4a0e3d8fec45437f06e7b570f84b94e4e9"),
  }),
  z.object({
    variant: z.literal("pytorch_weights_only_compatibility"),
    sha256: z.literal("ecabf4b7baf39d0c973d494bbd15e20cc981aa851981e66855117701b734fb41"),
  }),
]);
const envRuntimeSourceSchema = z.union([
  z.object({
    variant: z.literal("upstream"),
    sha256: z.literal("e91d7b7b35cc3ad2b073606c99860def6b3ac43b66eba00ef0ddb6bfd8f39c3c"),
  }),
  z.object({
    variant: z.literal("numpy_float64_compatibility"),
    sha256: z.literal("3084614bc4b1a5a6bf83773ceaae0a6d87b8e89fed304334b483ca1313efed57"),
  }),
]);
const evaluationSceneManifestSchema = z.object({
  schema_version: z.literal("libero-evaluation-scenes/v1"),
  status: z.literal("complete"),
  source: z.object({
    repository: z.literal("sylvestf/LIBERO-plus"),
    revision: z.string().regex(/^[0-9a-f]{40}$/),
    simulator_assets: z.object({
      repository: z.literal("Sylvest/LIBERO-plus"),
      revision: z.literal("dd2bd61b7d9a6fef1abc52d606e983b41886a149"),
      archive_sha256: z.literal("96764a4bfbdaea98d4411598caeab235458318fe0f549611b93d1a323027b3cf"),
      archive_bytes: z.literal(6395849578),
      extracted_file_count: z.literal(448799),
      tree_hash_schema: z.literal("libero-plus-asset-tree-sha256/v1"),
      tree_sha256: z.literal("6c4c2e638f6401304f01b2573c80af41b35b6d94838df71f6ab91f59468b7ecb"),
    }),
    runtime_source_files: z.object({
      "libero/libero/benchmark/__init__.py": benchmarkRuntimeSourceSchema,
      "libero/libero/envs/env_wrapper.py": envRuntimeSourceSchema,
    }),
  }),
  initialization: z.object({
    state_index: z.literal(0),
    settle_zero_actions: z.literal(5),
    environment_seed: z.literal(10000),
    constructor_randomization_policy: z.literal("retry_without_reseeding"),
    constructor_attempt_limit: z.literal(100),
    action_dimension: z.literal(7),
    source_procedure: z.literal("LIBERO-plus/benchmark_scripts/render_single_task.py"),
  }),
  counts: z.object({
    source_tasks: z.literal(40),
    conditions: z.literal(10030),
    geometry_assets: z.number().int().positive(),
    texture_assets: z.number().int().positive(),
  }),
  tasks: z.record(
    z.string().min(1),
    z.object({
      task_key: z.string().min(1),
      suite: z.string().min(1),
      name: z.string().min(1),
      condition_count: z.number().int().positive(),
      condition_shard: relativeArtifactSchema,
      condition_shard_bytes: z.number().int().positive(),
      shard_sha256: sha256Schema,
      geometry_pack: relativeArtifactSchema,
      geometry_bytes: z.number().int().positive(),
      geometry_sha256: sha256Schema,
      geometry_count: z.number().int().positive(),
    }),
  ),
});
const sceneRecordSchema = z.object({
  condition: z.object({
    task_key: z.string().min(1),
    suite: z.string().min(1),
    suite_id: z.number().int().nonnegative(),
    name: z.string().min(1),
    category: z.string().min(1),
    difficulty: z.union([z.number().int().min(1).max(5), z.null()]),
    base_task_key: z.string().min(1),
  }),
  settings: z.record(z.string(), z.union([z.string(), finite])),
  initialization: z.object({
    state_index: z.literal(0),
    settle_zero_actions: z.literal(5),
    environment_seed: z.literal(10000),
    control_action: z.tuple([finite, finite, finite, finite, finite, finite, finite]),
    runtime_bddl: relativeArtifactSchema,
    resolved_bddl: relativeArtifactSchema,
    resolved_bddl_sha256: sha256Schema,
    init_state: relativeArtifactSchema,
    init_state_sha256: sha256Schema,
    physical_state_key: sha256Schema,
  }),
  snapshot: sceneSnapshotSchema,
});
const evaluationSceneShardSchema = z.object({
  schema_version: z.literal("libero-evaluation-scene-shard/v1"),
  task_key: z.string().min(1),
  geometry_pack: relativeArtifactSchema,
  records: z.record(z.string().min(1), sceneRecordSchema),
});
const dataSourceRegistrySchema = z.object({
  groups: z.array(
    z.object({
      group_id: z.enum([
        "original_libero",
        "libero_plus_training",
        "libero_plus_evaluation",
        "related_packages",
      ]),
      title: z.string().min(1),
      purpose: z.string().min(1),
      sources: z.array(
        z.object({
          source_id: z.string().min(1),
          role: z.enum([
            "task_definitions",
            "recorded_trajectories",
            "training_provenance",
            "evaluation_definitions",
            "simulator_assets",
            "related_package",
          ]),
          label: z.string().min(1),
          repository: z.string().min(1),
          revision: z.string().min(1),
          url: z.string().url(),
          structure: z.array(z.string().min(1)),
          counts: z.record(z.string().min(1), z.number().int().nonnegative()),
        }),
      ),
    }),
  ),
});
type EvaluationSceneManifest = z.infer<typeof evaluationSceneManifestSchema>;
type EvaluationSceneShard = z.infer<typeof evaluationSceneShardSchema>;
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
let evaluationSceneManifestPromise: Promise<EvaluationSceneManifest> | undefined;
const shardPromises = new Map<string, Promise<HostedTaskShard>>();
const bddlPromises = new Map<string, Promise<string>>();
const evaluationSceneShardPromises = new Map<string, Promise<EvaluationSceneShard>>();

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

async function checkedGzipJson<T>(url: string): Promise<T> {
  if (!("DecompressionStream" in globalThis))
    throw new ApiError("This browser cannot decode hosted gzip scene data", 409, url);
  const response = await fetch(url, { headers: { Accept: "application/gzip" } });
  if (!response.ok)
    throw new ApiError(`Data request failed: ${response.status}`, response.status, url);
  if (!response.body) throw new ApiError("Gzip data response has no body", 409, url);
  const decompressed = response.body.pipeThrough(new DecompressionStream("gzip"));
  return (await new Response(decompressed).json()) as T;
}

async function manifest(): Promise<HostedManifest> {
  manifestPromise ??= checkedJson<unknown>(manifestUrl).then((value) =>
    manifestSchema.parse(value),
  );
  return manifestPromise;
}

async function evaluationSceneManifest(): Promise<{
  manifest: EvaluationSceneManifest;
  assetId: string;
}> {
  const hosted = await manifest();
  const assetId = resolveFrom(manifestUrl, hosted.evaluation.scene_manifest);
  evaluationSceneManifestPromise ??= checkedJson<unknown>(assetId).then((value) => {
    const parsed = evaluationSceneManifestSchema.parse(value);
    const tasks = Object.values(parsed.tasks);
    if (
      parsed.source.revision !== hosted.evaluation.revision ||
      tasks.length !== parsed.counts.source_tasks ||
      tasks.reduce((total, task) => total + task.condition_count, 0) !== parsed.counts.conditions
    ) {
      throw new ApiError("Evaluation scene manifest identity mismatch", 409, assetId);
    }
    return parsed;
  });
  return { manifest: await evaluationSceneManifestPromise, assetId };
}

async function evaluationSceneRecord(
  condition: EvaluationCondition,
): Promise<EvaluationSceneRecord> {
  const { manifest: scenes, assetId: sceneManifestAssetId } = await evaluationSceneManifest();
  const task = scenes.tasks[condition.base_task_key ?? ""];
  if (!task || task.task_key !== condition.base_task_key)
    throw new ApiError(
      "Evaluation source task has no initial-scene shard",
      409,
      condition.task_key,
    );
  let promise = evaluationSceneShardPromises.get(task.condition_shard);
  if (!promise) {
    const shardAssetId = resolveFrom(sceneManifestAssetId, task.condition_shard);
    promise = checkedGzipJson<unknown>(shardAssetId).then((value) =>
      evaluationSceneShardSchema.parse(value),
    );
    evaluationSceneShardPromises.set(task.condition_shard, promise);
  }
  const shard = await promise;
  if (shard.task_key !== condition.base_task_key || shard.geometry_pack !== task.geometry_pack)
    throw new ApiError("Evaluation initial-scene shard identity mismatch", 409, condition.task_key);
  const record = shard.records[condition.task_key];
  if (
    !record ||
    record.condition.task_key !== condition.task_key ||
    record.condition.base_task_key !== condition.base_task_key ||
    record.condition.suite !== condition.suite ||
    record.condition.suite_id !== condition.suite_id ||
    record.condition.name !== condition.name ||
    record.condition.category !== condition.category ||
    record.condition.difficulty !== condition.difficulty
  )
    throw new ApiError("Evaluation initial scene not found", 404, condition.task_key);
  return {
    ...record,
    geometry_pack_asset_id: resolveFrom(sceneManifestAssetId, task.geometry_pack),
    texture_base_asset_id: resolveFrom(sceneManifestAssetId, "textures/"),
  } as EvaluationSceneRecord;
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
    const result = dataSourceRegistrySchema.parse(
      await checkedJson<unknown>(await dataUrl(value.catalog.sources)),
    );
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
  const [bddl, catalogValue, sceneValue] = await Promise.all([
    bddlFor(condition),
    catalog(),
    evaluationSceneManifest(),
  ]);
  const base = catalogValue.details[condition.base_task_key ?? ""];
  if (!base) throw new ApiError("Evaluation source task not found", 409, taskKey);
  const sceneTask = sceneValue.manifest.tasks[base.task_key];
  if (!sceneTask || sceneTask.task_key !== base.task_key)
    throw new ApiError("Evaluation source task has no initial-scene data", 409, taskKey);
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
    initial_scene: {
      schema_version: "libero-evaluation-scenes/v1",
      condition_key: condition.task_key,
      source_task_key: base.task_key,
      state_index: 0,
      settle_zero_actions: 5,
      environment_seed: 10000,
      constructor_randomization_policy: "retry_without_reseeding",
      constructor_attempt_limit: 100,
      action_dimension: 7,
      source_procedure: "LIBERO-plus/benchmark_scripts/render_single_task.py",
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
  if (parts[0] === "evaluation" && parts[1] === "conditions" && parts[2] && parts[3] === "scene") {
    const condition = (await evaluationConditions()).find((item) => item.task_key === parts[2]);
    if (!condition) throw new ApiError("Evaluation condition not found", 404, parts[2]);
    return evaluationSceneRecord(condition);
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
