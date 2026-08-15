import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { delay, HttpResponse, http } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type {
  EvaluationCondition,
  ReplayContext,
  ReplayContextItem,
  ReplayManifest,
  ReplaySeries,
} from "@/shared/api";
import { ReplayWorkbench } from "./replay-workbench";

function analysisSceneGlb(): Uint8Array {
  const vertices = new Float32Array([
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5,
    0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  ]);
  const normals = new Float32Array([
    -0.577, -0.577, -0.577, 0.577, -0.577, -0.577, 0.577, 0.577, -0.577, -0.577, 0.577, -0.577,
    -0.577, -0.577, 0.577, 0.577, -0.577, 0.577, 0.577, 0.577, 0.577, -0.577, 0.577, 0.577,
  ]);
  const indices = new Uint16Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0,
    4, 3, 4, 7,
  ]);
  const texcoords = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]);
  const texturePng = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mPY1+QGAAOIAYeqPyFgAAAAAElFTkSuQmCC",
    ),
    (character) => character.charCodeAt(0),
  );
  const textureOffset =
    vertices.byteLength + normals.byteLength + indices.byteLength + texcoords.byteLength;
  const binary = new Uint8Array(textureOffset + texturePng.byteLength);
  binary.set(new Uint8Array(vertices.buffer), 0);
  binary.set(new Uint8Array(normals.buffer), vertices.byteLength);
  binary.set(new Uint8Array(indices.buffer), vertices.byteLength + normals.byteLength);
  binary.set(
    new Uint8Array(texcoords.buffer),
    vertices.byteLength + normals.byteLength + indices.byteLength,
  );
  binary.set(texturePng, textureOffset);
  const scene = new TextEncoder().encode(
    JSON.stringify({
      asset: {
        version: "2.0",
        generator: "LIBERO EDA Storybook fixture",
        extras: {
          sceneSchema: "parc-mujoco-scene/v3",
          sceneFidelity: "recording_render_matched",
          sceneExporterRevision: "mujoco-classic-uv3",
          visualGeomGroup: 1,
          mujocoRender: {
            renderer: "mujoco_classic",
            color_space: "srgb_textures_linear_lighting",
            tone_mapping: "none",
            headlight: {
              active: true,
              ambient: [0.1, 0.1, 0.1],
              diffuse: [0.4, 0.4, 0.4],
              specular: [0.5, 0.5, 0.5],
            },
            lights: [
              {
                index: 0,
                name: "storybook_light",
                type: "spot",
                mode: "fixed_world",
                position: [1, 1, 4],
                direction: [0, -0.15, -1],
                ambient: [0, 0, 0],
                diffuse: [0.8, 0.8, 0.8],
                specular: [0.3, 0.3, 0.3],
                attenuation: [1, 0, 0],
                cutoff_degrees: 45,
                exponent: 10,
                active: true,
                cast_shadow: false,
              },
            ],
            shadow_map_size: 4096,
            skybox: null,
          },
        },
      },
      scene: 0,
      scenes: [{ nodes: [0, 1, 2, 3] }],
      nodes: [
        {
          name: "robot0_link0",
          mesh: 0,
          scale: [0.22, 0.22, 0.72],
          extras: { mujocoBodyIndex: 0, mujocoBodyName: "robot0_link0" },
        },
        {
          name: "robot0_link1",
          mesh: 1,
          scale: [0.13, 0.13, 0.52],
          extras: { mujocoBodyIndex: 1, mujocoBodyName: "robot0_link1" },
        },
        {
          name: "black_bowl",
          mesh: 2,
          scale: [0.24, 0.24, 0.1],
          extras: { mujocoBodyIndex: 2, mujocoBodyName: "black_bowl" },
        },
        {
          name: "table",
          mesh: 3,
          scale: [1.5, 1.0, 0.1],
          extras: {
            mujocoBodyIndex: 3,
            mujocoBodyName: "table",
            mujocoGeomType: 6,
            mujocoGeomSize: [0.5, 0.5, 0.5],
          },
        },
      ],
      meshes: [0, 1, 2, 3].map((material) => ({
        primitives: [
          {
            attributes: {
              POSITION: 0,
              NORMAL: 1,
              ...(material === 3 ? { TEXCOORD_0: 3 } : {}),
            },
            indices: 2,
            material,
          },
        ],
      })),
      materials: [
        [0.18, 0.42, 0.37, 1],
        [0.45, 0.48, 0.45, 1],
        [0.08, 0.09, 0.08, 1],
        [0.48, 0.32, 0.2, 1],
      ].map((rgba, materialIndex) => ({
        pbrMetallicRoughness: {
          baseColorFactor: rgba,
          ...(materialIndex === 3 ? { baseColorTexture: { index: 0, texCoord: 0 } } : {}),
        },
        extras: {
          mujocoMaterial: {
            rgba,
            emission: 0,
            specular: 0.3,
            shininess: 0.4,
            reflectance: 0,
            texuniform: false,
            texture_type: materialIndex === 3 ? 1 : null,
            texture_repeat: [1, 1],
          },
        },
      })),
      images: [{ bufferView: 4, mimeType: "image/png" }],
      textures: [{ sampler: 0, source: 0 }],
      samplers: [{ magFilter: 9729, minFilter: 9729, wrapS: 10497, wrapT: 10497 }],
      buffers: [{ byteLength: binary.byteLength }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: vertices.byteLength, target: 34962 },
        {
          buffer: 0,
          byteOffset: vertices.byteLength,
          byteLength: normals.byteLength,
          target: 34962,
        },
        {
          buffer: 0,
          byteOffset: vertices.byteLength + normals.byteLength,
          byteLength: indices.byteLength,
          target: 34963,
        },
        {
          buffer: 0,
          byteOffset: vertices.byteLength + normals.byteLength + indices.byteLength,
          byteLength: texcoords.byteLength,
          target: 34962,
        },
        {
          buffer: 0,
          byteOffset: textureOffset,
          byteLength: texturePng.byteLength,
        },
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 8,
          type: "VEC3",
          min: [-0.5, -0.5, -0.5],
          max: [0.5, 0.5, 0.5],
        },
        { bufferView: 1, componentType: 5126, count: 8, type: "VEC3" },
        { bufferView: 2, componentType: 5123, count: 36, type: "SCALAR" },
        { bufferView: 3, componentType: 5126, count: 8, type: "VEC2" },
      ],
    }),
  );
  const paddedSceneLength = Math.ceil(scene.length / 4) * 4;
  const paddedBinaryLength = Math.ceil(binary.length / 4) * 4;
  const result = new Uint8Array(12 + 8 + paddedSceneLength + 8 + paddedBinaryLength);
  const view = new DataView(result.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, result.length, true);
  view.setUint32(12, paddedSceneLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  result.set(scene, 20);
  result.fill(0x20, 20 + scene.length);
  const binaryHeader = 20 + paddedSceneLength;
  view.setUint32(binaryHeader, paddedBinaryLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  result.set(binary, binaryHeader + 8);
  return result;
}

const series: ReplaySeries = {
  schema_version: "parc-series/v2",
  time: [0, 0.05, 0.1, 0.15],
  frame_index: [0, 1, 2, 3],
  ee_positions: [
    [0.42, 0.02, 0.82],
    [0.45, 0.02, 0.8],
    [0.48, 0.03, 0.78],
    [0.51, 0.04, 0.8],
  ],
  ee_axis_angle: [
    [0, 0, 0],
    [0.01, 0, 0],
    [0.02, 0.01, 0],
    [0.02, 0.01, 0.01],
  ],
  gripper_qpos: [
    [0.04, -0.04],
    [0.03, -0.03],
    [0.01, -0.01],
    [0.01, -0.01],
  ],
  actions: [
    [0.1, 0, -0.1, 0, 0, 0, 1],
    [0.1, 0, -0.1, 0, 0, 0, 1],
    [0.1, 0.1, 0, 0, 0, 0, -1],
    [0, 0, 0.1, 0, 0, 0, -1],
  ],
  rewards: [0, 0, 0, 1],
  joints: [],
  body_positions: [
    [
      [-0.08, 0, 0.36],
      [0.08, 0, 0.92],
      [0.52, 0.16, 0.79],
      [0.3, 0.08, 0.68],
    ],
    [
      [-0.08, 0, 0.36],
      [0.1, 0.01, 0.93],
      [0.52, 0.16, 0.79],
      [0.3, 0.08, 0.68],
    ],
    [
      [-0.08, 0, 0.36],
      [0.13, 0.02, 0.92],
      [0.5, 0.15, 0.79],
      [0.3, 0.08, 0.68],
    ],
    [
      [-0.08, 0, 0.36],
      [0.16, 0.03, 0.9],
      [0.48, 0.13, 0.8],
      [0.3, 0.08, 0.68],
    ],
  ],
  body_quaternions: Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => [1, 0, 0, 0])),
  object_displacements: {},
  chunk_boundaries: [],
  speed: [0, 0.63, 0.65, 0.5],
  acceleration: [0, 0.2, 0.25, 0.1],
  jerk: [0, 0.1, 0.15, 0.05],
};

const originalManifest: ReplayManifest = {
  schema_version: "parc-replay/v2",
  replay_id: "original-libero-libero_spatial-005-00",
  source: "dataset",
  dataset_id: "original_libero",
  source_episode_id: "libero_spatial:5:0",
  task_key: "libero:libero_spatial:5",
  task_name: "Pick the black bowl from the top drawer and place it on the plate",
  episode_id: 0,
  init_index: null,
  fps: 20,
  state_count: 4,
  action_count: 4,
  action_horizon: null,
  series_asset_id: "series-original",
  videos: [
    {
      camera: "agentview",
      asset_id: "front-video",
      start_time_sec: 0,
      end_time_sec: 0.2,
      frame_offset: 0,
      width: 128,
      height: 128,
      default_display_transform: "identity",
      display_transform_provenance: "app:parc-eda/original-libero-derived-v1",
    },
    {
      camera: "robot0_eye_in_hand",
      asset_id: "wrist-video",
      start_time_sec: 0,
      end_time_sec: 0.2,
      frame_offset: 0,
      width: 128,
      height: 128,
      default_display_transform: "identity",
      display_transform_provenance: "app:parc-eda/original-libero-derived-v1",
    },
  ],
  scene_asset_id: "analysis-scene",
  scene_hash: "storybook-scene",
  scene_schema: "parc-mujoco-scene/v3",
  scene_fidelity: "recording_render_matched",
  scene_fidelity_reason: "Storybook scene with recorded textures",
  body_names: ["robot0_link0", "robot0_link1", "black_bowl", "table"],
  scene_cameras: [
    {
      camera: "agentview",
      position: [0.6, 0, 1.5],
      rotation_matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      rotation_matrix_layout: "row_major",
      rotation_matrix_convention: "camera_local_to_world",
      camera_axis_convention: "mujoco_camera",
      vertical_fov_degrees: 45,
      scope: "fixed_world",
      calibration_provenance: "Storybook fixed-camera fixture",
    },
  ],
  outcome: { success: true },
  provenance: { numeric_state_is_lossless: true },
};

const plusManifest: ReplayManifest = {
  ...originalManifest,
  replay_id: "demo-400",
  dataset_id: "lerobot_libero_plus",
  source_episode_id: "400",
  episode_id: 400,
  init_index: null,
  scene_asset_id: null,
  scene_hash: null,
  scene_schema: "legacy-analysis",
  scene_fidelity: "none",
  scene_fidelity_reason: "The distributed LIBERO-Plus training record has no scene metadata",
  body_names: [],
  scene_cameras: [],
  videos: originalManifest.videos.map((video) => ({
    ...video,
    default_display_transform: "rotate_180",
    display_transform_provenance: "app:parc-eda/lerobot-libero-plus-v1",
  })),
  outcome: {},
  provenance: {
    digital_twin_available: false,
    digital_twin_reason: "The training dataset does not contain full MuJoCo body state",
  },
};

const delayedSceneManifest: ReplayManifest = {
  ...originalManifest,
  replay_id: "delayed-scene-demo",
  scene_asset_id: "delayed-analysis-scene",
  scene_hash: "storybook-delayed-scene",
};

const retrySceneManifest: ReplayManifest = {
  ...originalManifest,
  replay_id: "retry-scene-demo",
  scene_asset_id: "retry-analysis-scene",
  scene_hash: "storybook-retry-scene",
};

const legacyOriginalManifest: ReplayManifest = {
  ...originalManifest,
  replay_id: "original-libero-legacy-scene",
  scene_schema: "legacy-analysis",
  scene_fidelity: "analysis_approximate",
  scene_fidelity_reason: "Legacy analysis scene without recorded textures",
};

const missingVideoDimensionsManifest: ReplayManifest = {
  ...plusManifest,
  replay_id: "missing-video-dimensions",
  videos: plusManifest.videos.map((video, index) =>
    index === 0 ? { ...video, width: null, height: null } : video,
  ),
};

const languageCandidates: EvaluationCondition[] = [
  {
    task_key: "plus:libero_spatial:language:1",
    source: "libero_plus",
    suite: "libero_spatial",
    suite_id: 301,
    name: "Lift the black bowl beside the ramekin and set it on the plate",
    instruction: "Lift the black bowl beside the ramekin and set it on the plate",
    base_task_key: originalManifest.task_key,
    plus_task_key: "plus:libero_spatial:language:1",
    category: "Language Instructions",
    difficulty: 1,
    scene: null,
    is_t1: false,
    t1_ordinal: null,
    t1_instruction: null,
    entry_kind: "changed_variant",
    base_task: {
      task_key: originalManifest.task_key as string,
      suite: "libero_spatial",
      suite_id: 5,
      name: originalManifest.task_name,
      instruction: originalManifest.task_name,
    },
  },
  {
    task_key: "plus:libero_spatial:language:2",
    source: "libero_plus",
    suite: "libero_spatial",
    suite_id: 302,
    name: "Place the dark bowl by the ramekin onto the plate",
    instruction: "Place the dark bowl by the ramekin onto the plate",
    base_task_key: originalManifest.task_key,
    plus_task_key: "plus:libero_spatial:language:2",
    category: "Language Instructions",
    difficulty: 4,
    scene: null,
    is_t1: false,
    t1_ordinal: null,
    t1_instruction: null,
    entry_kind: "changed_variant",
    base_task: {
      task_key: originalManifest.task_key as string,
      suite: "libero_spatial",
      suite_id: 5,
      name: originalManifest.task_name,
      instruction: originalManifest.task_name,
    },
  },
];

function contextItem(manifest: ReplayManifest, episodeId: number): ReplayContextItem {
  const plus = manifest.dataset_id === "lerobot_libero_plus";
  return {
    replay_id: plus
      ? `demo-${episodeId}`
      : `original-libero-libero_spatial-005-${String(episodeId).padStart(2, "0")}`,
    source: "dataset",
    dataset_id: manifest.dataset_id,
    run_id: null,
    source_episode_id: plus ? String(episodeId) : `libero_spatial:5:${episodeId}`,
    task_key: manifest.task_key,
    task_name: manifest.task_name,
    original_task_instruction: manifest.task_name,
    episode_id: episodeId,
    init_index: null,
    state_count: 4,
    fps: 20,
    duration_sec: 0.2,
    outcome: plus ? {} : { success: true },
    training_environment_category:
      plus && episodeId === manifest.episode_id ? "language" : plus ? "camera_view" : null,
    training_instruction: plus ? manifest.task_name : null,
    training_instruction_source: plus ? "official_rlds.steps/language_instruction" : null,
    training_instruction_availability: plus ? "published" : "not_applicable",
    training_instruction_relation: plus ? "same_as_original_task" : "not_applicable",
  };
}

function replayContext(manifest: ReplayManifest, currentIncluded = true): ReplayContext {
  const plus = manifest.dataset_id === "lerobot_libero_plus";
  const currentEpisode = manifest.episode_id;
  const firstEpisode = Math.max(0, currentEpisode - 1);
  const items = [firstEpisode, firstEpisode + 1, firstEpisode + 2].map((episodeId) =>
    contextItem(manifest, episodeId),
  );
  const currentIndex = items.findIndex((item) => item.replay_id === manifest.replay_id);
  return {
    scope: {
      kind: "task",
      label: `${plus ? "LIBERO-Plus training trajectory" : "Original LIBERO official demonstration"} · ${manifest.task_name}`,
      dataset_id: manifest.dataset_id,
      run_id: null,
      task_key: manifest.task_key,
    },
    filters: {
      q: currentIncluded ? null : "another task",
      training_environment_category: null,
      outcome: null,
    },
    items: currentIncluded ? items : items.filter((item) => item.replay_id !== manifest.replay_id),
    total: currentIncluded ? 3 : 2,
    limit: 50,
    offset: 0,
    current_index: currentIncluded ? currentIndex : null,
    previous_replay_id:
      currentIncluded && currentIndex > 0 ? (items[currentIndex - 1]?.replay_id ?? null) : null,
    next_replay_id:
      currentIncluded && currentIndex < items.length - 1
        ? (items[currentIndex + 1]?.replay_id ?? null)
        : null,
  };
}

function handlers(
  manifest: ReplayManifest,
  withBodyState: boolean,
  context = replayContext(manifest),
  sceneOptions: { delayMs?: number; failOnce?: boolean; manifestDelayMs?: number } = {},
) {
  let sceneAttempts = 0;
  const sceneAssetId = manifest.scene_asset_id ?? "analysis-scene";
  return [
    http.get("/api/v1/evaluation/conditions", () =>
      HttpResponse.json({
        items: languageCandidates,
        total: languageCandidates.length,
        limit: 500,
        offset: 0,
      }),
    ),
    http.get("/api/v1/replays/:replayId/context", () => HttpResponse.json(context)),
    http.get("/api/v1/replays/:replayId", async () => {
      if (sceneOptions.manifestDelayMs) await delay(sceneOptions.manifestDelayMs);
      return HttpResponse.json(manifest);
    }),
    http.get("/api/v1/replays/:replayId/series", () =>
      HttpResponse.json({
        ...series,
        body_positions: withBodyState ? series.body_positions : [],
        body_quaternions: withBodyState ? series.body_quaternions : [],
      }),
    ),
    http.get("/api/v1/datasets/lerobot_libero_plus/training-environment-categories", () =>
      HttpResponse.json({
        dataset_id: "lerobot_libero_plus",
        display_name: "LIBERO-Plus training trajectories",
        source_namespace: "official_rlds_episode_metadata.file_path",
        base_task_key: manifest.task_key,
        strength_availability: "not_published",
        training_instruction: {
          availability: "published",
          source_feature: "official_rlds.steps/language_instruction",
        },
        training_instruction_relations: [{ relation: "same_as_original_task", episode_count: 14 }],
        items: [
          { category: "camera_view", episode_count: 3 },
          { category: "language", episode_count: 2 },
          { category: "env", episode_count: 4 },
          { category: "light", episode_count: 3 },
          { category: "noise", episode_count: 4 },
        ],
      }),
    ),
    http.get(`/api/v1/media/${sceneAssetId}`, async () => {
      if (sceneOptions.delayMs) await delay(sceneOptions.delayMs);
      sceneAttempts += 1;
      if (sceneOptions.failOnce && sceneAttempts === 1) {
        return new HttpResponse(null, { status: 503 });
      }
      return new HttpResponse(analysisSceneGlb(), {
        headers: { "Content-Type": "model/gltf-binary" },
      });
    }),
    http.get("/api/v1/media/:assetId", () => new HttpResponse(null, { status: 204 })),
  ];
}

const meta = {
  title: "Widgets/Replay Workbench",
  component: ReplayWorkbench,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="mx-auto h-screen w-full max-w-[2200px] overflow-hidden bg-base-200 p-6">
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof ReplayWorkbench>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OriginalLiberoDigitalTwin: Story = {
  args: { replayId: originalManifest.replay_id },
  parameters: { msw: { handlers: handlers(originalManifest, true) } },
  globals: { viewport: { value: "desktop2560", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("MuJoCo-matched 3D")).toBeVisible();
    const legend = canvas.getByRole("figure", {
      name: "Trajectory hue by gripper command and opacity by passage",
    });
    await expect(within(legend).getByText("Open command")).toBeVisible();
    await expect(within(legend).getByText("Close command")).toBeVisible();
    await expect(within(legend).getByText("Passed")).toBeVisible();
    await expect(within(legend).getByText("Current")).toBeVisible();
    await expect(within(legend).getByText("Ahead")).toBeVisible();
    await expect(within(legend).getByText("Rainbow flows continuously")).toBeVisible();
    await expect(
      within(legend).getByText("Current position · follows trajectory hue"),
    ).toBeVisible();
    await expect(
      within(legend).getByText("axes (R=X, G=Y, B=Z) · current EEF orientation"),
    ).toBeVisible();
    await expect(canvas.getByTestId("current-rotation-vector")).toHaveTextContent(
      "[0.0000, 0.0000, 0.0000]",
    );
    await expect(canvas.queryByText("Scene & camera")).toBeNull();
    await expect(canvas.getByRole("button", { name: "Front sync" })).toBeVisible();
    await expect(
      within(canvas.getByTestId("replay-command-bar")).queryByText("Success"),
    ).toBeNull();
    await expect(canvas.queryByRole("button", { name: "Wide FOV" })).toBeNull();
    await expect(canvas.queryByTestId("replay-layout-toggle")).toBeNull();
    const video = canvas.getByTestId("video-panel").getBoundingClientRect();
    const spatial = canvas.getByTestId("spatial-panel").getBoundingClientRect();
    const stage = canvas.getByTestId("replay-stage").getBoundingClientRect();
    const timeline = canvas.getByTestId("replay-timeline").getBoundingClientRect();
    await expect(canvas.getByTestId("video-media-agentview")).toHaveTextContent(/^$/);
    await expect(canvas.getByTestId("video-media-robot0_eye_in_hand")).toHaveTextContent(/^$/);
    await expect(spatial.width / video.width).toBeGreaterThan(2);
    await expect(stage.height / timeline.height).toBeGreaterThan(1.45);
  },
};

export const LoadingWorkspace: Story = {
  args: { replayId: originalManifest.replay_id },
  parameters: {
    msw: {
      handlers: handlers(originalManifest, true, replayContext(originalManifest), {
        manifestDelayMs: 800,
      }),
    },
  },
  globals: { viewport: { value: "desktop2k", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const skeleton = await canvas.findByTestId("replay-workbench-skeleton");
    await expect(skeleton).toHaveAttribute("aria-busy", "true");
    await expect(skeleton).toHaveAttribute("aria-label", "Loading replay workspace");
    await waitFor(() => expect(canvas.queryByTestId("replay-workbench-skeleton")).toBeNull(), {
      timeout: 3_000,
    });
  },
};

export const DelayedSceneModel: Story = {
  args: { replayId: delayedSceneManifest.replay_id },
  parameters: {
    msw: {
      handlers: handlers(delayedSceneManifest, true, replayContext(delayedSceneManifest), {
        delayMs: 800,
      }),
    },
  },
  globals: { viewport: { value: "desktop2k", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("scene-model-loading")).toHaveTextContent(
      "Loading robot and scene…",
    );
    await expect(
      canvas.getByRole("img", { name: /3D view of the robot, objects, and EEF trajectory/ }),
    ).toBeVisible();
    await waitFor(() => expect(canvas.queryByTestId("scene-model-loading")).toBeNull(), {
      timeout: 3_000,
    });
  },
};

export const SceneModelRetry: Story = {
  args: { replayId: retrySceneManifest.replay_id },
  parameters: {
    test: { dangerouslyIgnoreUnhandledErrors: true },
    msw: {
      handlers: handlers(retrySceneManifest, true, replayContext(retrySceneManifest), {
        delayMs: 400,
        failOnce: true,
      }),
    },
  },
  globals: { viewport: { value: "desktop2k", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const error = await canvas.findByTestId("scene-model-error");
    await expect(error).toHaveTextContent("Scene model failed to load.");
    await expect(canvas.queryByTestId("scene-model-loading")).toBeNull();
    await userEvent.click(within(error).getByRole("button", { name: "Retry" }));
    await expect(await canvas.findByTestId("scene-model-loading")).toBeVisible();
    await waitFor(() => expect(canvas.queryByTestId("scene-model-loading")).toBeNull(), {
      timeout: 3_000,
    });
    await expect(canvas.queryByTestId("scene-model-error")).toBeNull();
  },
};

export const LegacyApproximateDigitalTwin: Story = {
  args: { replayId: legacyOriginalManifest.replay_id },
  parameters: { msw: { handlers: handlers(legacyOriginalManifest, true) } },
  globals: { viewport: { value: "desktop2k", isRotated: false } },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("Approximate 3D")).toBeVisible();
  },
};

export const LiberoPlusEefOnly: Story = {
  args: { replayId: plusManifest.replay_id },
  parameters: { msw: { handlers: handlers(plusManifest, false) } },
  globals: { viewport: { value: "desktop2k", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const media = await canvas.findByTestId("video-media-agentview");
    await expect(canvas.queryByTestId("scene-model-loading")).toBeNull();
    const toolbar = canvas.getByTestId("video-orientation-toolbar-agentview");
    const vertical = await canvas.findByRole("button", {
      name: "Flip Front / agentview vertically",
    });
    const mediaBox = media.getBoundingClientRect();
    const toolbarBox = toolbar.getBoundingClientRect();
    await expect(toolbarBox.right).toBeLessThanOrEqual(mediaBox.left + 1);
    await expect(Math.abs(toolbarBox.top - mediaBox.top)).toBeLessThan(2);
    await expect(Math.abs(mediaBox.width - mediaBox.height)).toBeLessThan(2);
    await expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth);
    let previousControlTop = -Infinity;
    for (const control of within(toolbar).getAllByRole("button")) {
      const box = control.getBoundingClientRect();
      await expect(box.width).toBeGreaterThanOrEqual(40);
      await expect(box.height).toBeGreaterThanOrEqual(40);
      await expect(box.top).toBeGreaterThan(previousControlTop);
      previousControlTop = box.top;
    }
    const frontPane = canvas.getByTestId("video-pane-agentview").getBoundingClientRect();
    const wristPane = canvas.getByTestId("video-pane-robot0_eye_in_hand").getBoundingClientRect();
    await expect(Math.abs(frontPane.left - wristPane.left)).toBeLessThan(2);
    await expect(Math.abs(frontPane.width - wristPane.width)).toBeLessThan(2);
    await expect(frontPane.bottom).toBeLessThanOrEqual(wristPane.top + 1);
    const playheadDomain = canvas.getByTestId("replay-playhead-domain").getBoundingClientRect();
    const plotDomain = canvas.getByTestId("replay-plot-domain").getBoundingClientRect();
    await expect(Math.abs(playheadDomain.left - plotDomain.left)).toBeLessThanOrEqual(1);
    await expect(Math.abs(playheadDomain.width - plotDomain.width)).toBeLessThanOrEqual(1);
    await expect(vertical).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(vertical);
    await expect(vertical).toHaveAttribute("aria-pressed", "false");
    await expect(
      canvas.getByRole("button", { name: /Reset Front \/ agentview orientation/ }),
    ).toBeEnabled();
    await expect(canvas.getByRole("navigation", { name: "Filtered records" })).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Back to Recorded Data" })).toHaveAttribute(
      "href",
      "/data/?dataset=lerobot_libero_plus&task=libero%3Alibero_spatial%3A5",
    );
    const candidates = await canvas.findByRole("button", {
      name: /Evaluation rewrites for this task.*2/,
    });
    await userEvent.click(candidates);
    const dialog = within(document.body).getByRole("dialog", {
      name: "Published evaluation instruction rewrites",
    });
    await expect(dialog).toBeVisible();
    await expect(
      within(dialog).getByText("Lift the black bowl beside the ramekin and set it on the plate"),
    ).toBeVisible();
    await expect(
      within(dialog).getByText("public training artifact does not identify", { exact: false }),
    ).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Close evaluation rewrites" }),
    );
    await expect(canvas.getByRole("link", { name: /Dataset episode #400/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(
      canvas.getByRole("link", { name: "Previous record" }).getAttribute("href"),
    ).toContain("demo-399");
    const video = canvas.getByTestId("video-panel").getBoundingClientRect();
    const spatial = canvas.getByTestId("spatial-panel").getBoundingClientRect();
    if (window.innerWidth >= 1920) {
      await expect(spatial.width / video.width).toBeGreaterThan(2.5);
      await expect(Math.abs(video.height - spatial.height)).toBeLessThan(8);
      await expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(window.innerHeight);
    }
  },
};

export const CurrentRecordingFilteredOut: Story = {
  args: { replayId: plusManifest.replay_id },
  parameters: {
    msw: {
      handlers: handlers(plusManifest, false, replayContext(plusManifest, false)),
    },
  },
  globals: { viewport: { value: "desktop2k", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText(
        "The current record is outside this filter. Select another record from the list.",
      ),
    ).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Previous record" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Next record" })).toBeDisabled();
  },
};

export const MissingVideoDimensionsFailsClosed: Story = {
  args: { replayId: missingVideoDimensionsManifest.replay_id },
  parameters: {
    msw: {
      handlers: handlers(missingVideoDimensionsManifest, false),
    },
  },
  globals: { viewport: { value: "desktop2k", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Unable to load data")).toBeVisible();
    await userEvent.click(canvas.getByText("Technical details"));
    await expect(
      canvas.getByText("Recorded video dimensions are required for Replay layout."),
    ).toBeVisible();
  },
};

export const TabletRecordingDrawer: Story = {
  args: { replayId: plusManifest.replay_id },
  parameters: { msw: { handlers: handlers(plusManifest, false) } },
  globals: { viewport: { value: "tablet834", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByRole("button", { name: /Records/ });
    const detailPane = canvas.getByTestId("replay-detail-pane");
    const triggerBox = trigger.getBoundingClientRect();
    const detailBox = detailPane.getBoundingClientRect();
    await expect(triggerBox.height).toBeLessThanOrEqual(40);
    await expect(detailBox.top - triggerBox.bottom).toBeLessThan(24);
    await userEvent.click(trigger);
    const dialog = within(document.body).getByRole("dialog", { name: "Filtered records" });
    await expect(dialog).toBeVisible();
    await expect(within(dialog).getByLabelText("Record list scope")).toHaveValue("task");
    await expect(
      within(dialog).getByRole("navigation", { name: "Filtered records" }),
    ).toBeVisible();
    await expect(within(dialog).getByLabelText("Replay distribution path tag")).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "Close record list" }));
    const front = canvas.getByTestId("video-pane-agentview").getBoundingClientRect();
    const wrist = canvas.getByTestId("video-pane-robot0_eye_in_hand").getBoundingClientRect();
    const video = canvas.getByTestId("video-panel").getBoundingClientRect();
    const spatial = canvas.getByTestId("spatial-panel").getBoundingClientRect();
    await expect(Math.abs(front.top - wrist.top)).toBeLessThan(2);
    await expect(front.right).toBeLessThanOrEqual(wrist.left + 1);
    await expect(video.bottom).toBeLessThanOrEqual(spatial.top + 1);
  },
};
