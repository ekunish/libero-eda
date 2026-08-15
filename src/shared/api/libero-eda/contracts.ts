export type SourceCount = { source: string; count: number };
export type GroupCount = { count: number; [key: string]: string | number | null };
export type RecordingDatasetId = "original_libero" | "lerobot_libero_plus";

export type RecordingSet = {
  dataset_id: RecordingDatasetId;
  display_name: string;
  availability: "available" | "not_in_dataset";
  episode_count: number | null;
  expected_episode_count: number | null;
  frame_count: number | null;
  mean_episode_length: number | null;
  digital_twin_available: boolean;
};

export type TaskRecord = {
  task_key: string;
  source: "libero" | "libero_plus";
  suite: string;
  suite_id: number;
  name: string;
  instruction: string;
  base_task_key: string | null;
  plus_task_key: string | null;
  category: string | null;
  difficulty: number | null;
  scene: string | null;
  is_t1: boolean;
  t1_ordinal: number | null;
  t1_instruction: string | null;
  entry_kind?: "original" | "changed_variant" | "compatibility";
};

export type TaskFamily = {
  task_key: string;
  source: "libero";
  suite: string;
  suite_id: number;
  name: string;
  instruction: string;
  scene: string | null;
  original_collection: "libero_spatial" | "libero_object" | "libero_goal" | "libero_100";
  original_split: "libero_90" | "libero_10" | null;
  is_plus_source: boolean;
  changed_variant_count: number;
  matching_variant_count: number;
  matching_difficulty_levels: number[];
  matching_unlabeled_difficulty_count: number;
  compatibility_entry_count: number;
  t1_variant_count: number;
  t1_ordinals: number[];
  recording_sets: RecordingSet[];
};

export type TaskDetail = TaskRecord & {
  bddl: string;
  bddl_diff: string;
  definition_relation: "original" | "changed" | "same_text";
  lineage_root_key: string;
  related_total: number;
  related: Array<
    Pick<
      TaskRecord,
      | "task_key"
      | "source"
      | "suite"
      | "suite_id"
      | "name"
      | "category"
      | "difficulty"
      | "is_t1"
      | "t1_ordinal"
    >
  >;
};

export type CatalogSummary = {
  sources: SourceCount[];
  suites: GroupCount[];
  plus_variant_categories: GroupCount[];
  difficulties: GroupCount[];
  dataset: {
    tasks: number;
    episodes: number;
    frames: number;
    mean_length: number;
    median_length: number;
    min_length: number;
    max_length: number;
  };
  datasets: Array<{
    dataset_id: RecordingDatasetId;
    display_name: string;
    repository: string;
    revision: string;
    task_count: number;
    episode_count: number;
    frame_count: number;
    stored_bytes: number;
    source_bytes: number;
    provenance: Record<string, unknown>;
    mean_length: number;
    median_length: number;
    min_length: number;
    max_length: number;
  }>;
  t1: TaskRecord[];
  metadata: Record<string, string>;
};

export type Page<T> = { items: T[]; total: number; limit: number; offset: number };

export type DataSourceRecord = {
  source_id: string;
  role:
    | "task_definitions"
    | "recorded_trajectories"
    | "training_provenance"
    | "evaluation_definitions"
    | "simulator_assets"
    | "related_package";
  label: string;
  repository: string;
  revision: string;
  url: string;
  structure: string[];
  counts: Record<string, number>;
};

export type DataSourceRegistry = {
  groups: Array<{
    group_id:
      | "original_libero"
      | "libero_plus_training"
      | "libero_plus_evaluation"
      | "related_packages";
    title: string;
    purpose: string;
    sources: DataSourceRecord[];
  }>;
};

export type EvaluationCondition = TaskRecord & {
  base_task: Pick<TaskRecord, "task_key" | "suite" | "suite_id" | "name" | "instruction">;
};

export type EvaluationSummary = {
  total_conditions: number;
  source_task_count: number;
  matrix: Array<{ category: string; difficulty: number | null; count: number }>;
  suites: Array<{ suite: string; count: number }>;
  categories: string[];
  difficulty_levels: number[];
  unassigned_difficulty_count: number;
};

export type EvaluationConditionDetail = TaskDetail & {
  base_task: Pick<TaskRecord, "task_key" | "suite" | "suite_id" | "name" | "instruction" | "scene">;
  goal_expression: string | null;
  provenance_source: { repository: string; revision: string; task_key: string };
};
export type TrainingInstructionAvailability = "published" | "not_applicable";
export type TrainingInstructionRelation =
  | "same_as_original_task"
  | "different_from_original_task"
  | "not_applicable";

export type EpisodeRecord = {
  episode_index: number;
  source_episode_id: string;
  dataset_id: RecordingDatasetId;
  dataset_name: string;
  task_index: number;
  task_instruction: string;
  original_task_instruction: string;
  base_task_key: string;
  suite: string;
  length: number;
  duration_sec: number;
  replay_id: string;
  training_environment_category: string | null;
  training_environment_strength: string | null;
  training_environment_strength_status: "not_published" | "not_applicable";
  training_instruction: string | null;
  training_instruction_source: string | null;
  training_instruction_availability: TrainingInstructionAvailability;
  training_instruction_relation: TrainingInstructionRelation;
};

export type TaskEpisodes = Page<EpisodeRecord> & {
  dataset_id: RecordingDatasetId;
  dataset_name: string;
  availability: "available" | "not_in_dataset";
  relationship: "recorded_for_task" | "recorded_for_original_task" | "none";
  requested_task: Pick<
    TaskRecord,
    | "task_key"
    | "source"
    | "suite"
    | "suite_id"
    | "name"
    | "instruction"
    | "base_task_key"
    | "category"
    | "difficulty"
  >;
  recorded_task_key: string | null;
  lineage_task_key: string;
};

export type TrainingEnvironmentCategories = {
  dataset_id: RecordingDatasetId;
  display_name: string;
  source_namespace: "official_rlds_episode_metadata.file_path" | null;
  base_task_key: string | null;
  strength_availability: "not_published" | "not_applicable";
  items: Array<{ category: string; episode_count: number }>;
  training_instruction: {
    availability: "published";
    source_feature: "official_rlds.steps/language_instruction";
  };
  training_instruction_relations: Array<{
    relation: TrainingInstructionRelation;
    episode_count: number;
  }>;
};

export type ReplayVideo = {
  camera: string;
  asset_id: string;
  start_time_sec: number;
  end_time_sec: number | null;
  frame_offset: number;
  width: number | null;
  height: number | null;
  default_display_transform: "identity" | "rotate_180" | "unknown";
  display_transform_provenance: string;
};

export type SceneCameraCalibration = {
  camera: string;
  position: [number, number, number];
  rotation_matrix: [number, number, number, number, number, number, number, number, number];
  rotation_matrix_layout: "row_major";
  rotation_matrix_convention: "camera_local_to_world";
  camera_axis_convention: "mujoco_camera";
  vertical_fov_degrees: number;
  scope: "fixed_world";
  calibration_provenance: string;
};

export type ReplayManifest = {
  schema_version: "parc-replay/v2";
  replay_id: string;
  source: "dataset" | "rollout" | "legacy";
  dataset_id: RecordingDatasetId | null;
  source_episode_id: string | null;
  task_key: string | null;
  task_name: string;
  episode_id: number;
  init_index: number | null;
  fps: number;
  state_count: number;
  action_count: number;
  action_horizon: number | null;
  series_asset_id: string;
  videos: ReplayVideo[];
  scene_asset_id: string | null;
  scene_hash: string | null;
  scene_schema: "parc-mujoco-scene/v3" | "legacy-analysis";
  scene_fidelity: "recording_render_matched" | "analysis_approximate" | "none";
  scene_fidelity_reason: string;
  body_names: string[];
  scene_cameras: SceneCameraCalibration[];
  outcome: Record<string, boolean>;
  provenance: Record<string, unknown>;
};

export type ReplayContextScope = {
  kind: "task" | "dataset" | "run";
  label: string;
  dataset_id: RecordingDatasetId | null;
  run_id: string | null;
  task_key: string | null;
};

export type ReplayContextFilters = {
  q: string | null;
  training_environment_category: string | null;
  outcome: "success" | "failure" | null;
};

export type ReplayContextItem = {
  replay_id: string;
  source: "dataset" | "rollout" | "legacy";
  dataset_id: RecordingDatasetId | null;
  run_id: string | null;
  source_episode_id: string | null;
  task_key: string | null;
  task_name: string;
  original_task_instruction: string | null;
  episode_id: number;
  init_index: number | null;
  state_count: number;
  fps: number;
  duration_sec: number;
  outcome: Record<string, boolean>;
  training_environment_category: string | null;
  training_instruction: string | null;
  training_instruction_source: string | null;
  training_instruction_availability: TrainingInstructionAvailability;
  training_instruction_relation: TrainingInstructionRelation;
};

export type ReplayContext = {
  scope: ReplayContextScope;
  filters: ReplayContextFilters;
  items: ReplayContextItem[];
  total: number;
  limit: number;
  offset: number;
  current_index: number | null;
  previous_replay_id: string | null;
  next_replay_id: string | null;
};

export type ReplaySeries = {
  schema_version: "parc-series/v2";
  time: number[];
  frame_index: number[];
  ee_positions: number[][];
  ee_axis_angle?: number[][];
  ee_orientations?: number[][];
  gripper_qpos: number[][];
  actions: number[][];
  rewards: number[];
  joints: number[][];
  body_positions: number[][][];
  body_quaternions: number[][][];
  qpos?: number[][];
  qvel?: number[][];
  object_displacements: Record<string, number[]>;
  chunk_boundaries: number[];
  speed: number[];
  acceleration: number[];
  jerk: number[];
};
