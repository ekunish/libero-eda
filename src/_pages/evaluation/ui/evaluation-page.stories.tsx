import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import type {
  EvaluationCondition,
  EvaluationConditionDetail,
  EvaluationSceneRecord,
  EvaluationSummary,
  Page,
  TaskFamily,
} from "@/shared/api";
import EvaluationPage from "./evaluation-page";

const geometryKey = "1".repeat(64);

function evaluationGeometryGlb(): Uint8Array {
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
  const positionBytes = new Uint8Array(vertices.buffer);
  const normalBytes = new Uint8Array(normals.buffer);
  const indexBytes = new Uint8Array(indices.buffer);
  const binaryLength = positionBytes.length + normalBytes.length + indexBytes.length;
  const binary = new Uint8Array(binaryLength);
  binary.set(positionBytes, 0);
  binary.set(normalBytes, positionBytes.length);
  binary.set(indexBytes, positionBytes.length + normalBytes.length);
  const json = new TextEncoder().encode(
    JSON.stringify({
      asset: { version: "2.0", generator: "LIBERO EDA evaluation fixture" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: geometryKey, mesh: 0 }],
      meshes: [
        {
          primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, mode: 4 }],
        },
      ],
      buffers: [{ byteLength: binary.length }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: positionBytes.length, target: 34962 },
        {
          buffer: 0,
          byteOffset: positionBytes.length,
          byteLength: normalBytes.length,
          target: 34962,
        },
        {
          buffer: 0,
          byteOffset: positionBytes.length + normalBytes.length,
          byteLength: indexBytes.length,
          target: 34963,
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
      ],
    }),
  );
  const paddedJsonLength = Math.ceil(json.length / 4) * 4;
  const paddedBinaryLength = Math.ceil(binary.length / 4) * 4;
  const result = new Uint8Array(12 + 8 + paddedJsonLength + 8 + paddedBinaryLength);
  const view = new DataView(result.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, result.length, true);
  view.setUint32(12, paddedJsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  result.set(json, 20);
  result.fill(0x20, 20 + json.length, 20 + paddedJsonLength);
  const binaryHeader = 20 + paddedJsonLength;
  view.setUint32(binaryHeader, paddedBinaryLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  result.set(binary, binaryHeader + 8);
  return result;
}

const condition: EvaluationCondition = {
  task_key: "plus:libero_goal:42",
  source: "libero_plus",
  suite: "libero_goal",
  suite_id: 42,
  name: "open_middle_drawer_language_1",
  instruction: "Please make sure the middle drawer of the cabinet is open",
  base_task_key: "libero:libero_goal:1",
  plus_task_key: "plus:libero_goal:42",
  category: "Language Instructions",
  difficulty: 3,
  scene: "KITCHEN_SCENE3",
  is_t1: false,
  t1_ordinal: null,
  t1_instruction: null,
  entry_kind: "changed_variant",
  base_task: {
    task_key: "libero:libero_goal:1",
    suite: "libero_goal",
    suite_id: 1,
    name: "open_middle_drawer",
    instruction: "open the middle drawer of the cabinet",
  },
};
const summary: EvaluationSummary = {
  total_conditions: 10030,
  source_task_count: 40,
  categories: ["Background Textures", "Language Instructions", "Sensor Noise"],
  difficulty_levels: [1, 2, 3, 4, 5],
  unassigned_difficulty_count: 121,
  suites: [{ suite: "libero_goal", count: 2591 }],
  matrix: [
    { category: "Background Textures", difficulty: 2, count: 180 },
    { category: "Language Instructions", difficulty: 3, count: 259 },
    { category: "Sensor Noise", difficulty: 5, count: 320 },
  ],
};
const detail: EvaluationConditionDetail = {
  ...condition,
  bddl: "(:language Please make sure the middle drawer of the cabinet is open)\n(:goal (And (Open drawer)))",
  bddl_diff:
    "- open the middle drawer\n+ Please make sure the middle drawer of the cabinet is open",
  definition_relation: "changed",
  lineage_root_key: condition.base_task.task_key,
  related_total: 200,
  related: [],
  base_task: { ...condition.base_task, scene: "KITCHEN_SCENE3" },
  goal_expression: "(And (Open drawer))",
  provenance_source: {
    repository: "sylvestf/LIBERO-plus",
    revision: "4976dc30028e",
    task_key: condition.task_key,
  },
  initial_scene: {
    schema_version: "libero-evaluation-scenes/v1",
    condition_key: condition.task_key,
    source_task_key: condition.base_task.task_key,
    state_index: 0,
    settle_zero_actions: 5,
    environment_seed: 10000,
    constructor_randomization_policy: "retry_without_reseeding",
    constructor_attempt_limit: 100,
    action_dimension: 7,
    source_procedure: "LIBERO-plus/benchmark_scripts/render_single_task.py",
  },
};
const scene: EvaluationSceneRecord = {
  condition: {
    task_key: condition.task_key,
    suite: condition.suite,
    suite_id: condition.suite_id,
    name: condition.name,
    category: condition.category ?? "Language Instructions",
    difficulty: condition.difficulty,
    base_task_key: condition.base_task.task_key,
  },
  settings: { category: "Language Instructions", definition_variant: "language_1" },
  initialization: {
    state_index: 0,
    settle_zero_actions: 5,
    environment_seed: 10000,
    control_action: [0, 0, 0, 0, 0, 0, 0],
    runtime_bddl: "libero_goal/open_middle_drawer_language_1.bddl",
    resolved_bddl: "libero_goal/open_middle_drawer_language_1.bddl",
    resolved_bddl_sha256: "2".repeat(64),
    init_state: "libero_goal/open_middle_drawer.pruned_init",
    init_state_sha256: "3".repeat(64),
    physical_state_key: "4".repeat(64),
  },
  snapshot: {
    schema_version: "libero-evaluation-scene-snapshot/v1",
    scene_exporter_revision: "mujoco-classic-uv3",
    bodies: [
      {
        name: "drawer",
        translation: [0, 0, 0.8],
        rotation: [0, 0, 0, 1],
      },
    ],
    geoms: [
      {
        name: "drawer_visual",
        body: "drawer",
        geometry_key: geometryKey,
        material_key: "drawer_material",
        translation: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        geom_type: 6,
        geom_size: [0.3, 0.2, 0.08],
        reflective_surface: null,
      },
    ],
    materials: {
      drawer_material: {
        rgba: [0.45, 0.26, 0.12, 1],
        emission: 0,
        specular: 0.3,
        shininess: 0.4,
        reflectance: 0,
        texuniform: false,
        texture_type: null,
        texture_repeat: [1, 1],
        texture_key: null,
      },
    },
    render: {
      renderer: "mujoco_classic",
      color_space: "srgb_textures_linear_lighting",
      tone_mapping: "none",
      headlight: {
        active: true,
        ambient: [0.1, 0.1, 0.1],
        diffuse: [0.4, 0.4, 0.4],
        specular: [0.5, 0.5, 0.5],
      },
      lights: [],
      shadow_map_size: 4096,
      skybox: null,
    },
    cameras: [],
  },
  geometry_pack_asset_id: "/storybook-evaluation-geometry.glb",
  texture_base_asset_id: "/storybook-evaluation-textures/",
};
const family = {
  task_key: condition.base_task.task_key,
  suite: "libero_goal",
  suite_id: 1,
  instruction: condition.base_task.instruction,
} as TaskFamily;

const meta = {
  title: "Pages/Evaluation Conditions",
  component: EvaluationPage,
  parameters: {
    layout: "fullscreen",
    nextjs: { navigation: { pathname: "/evaluation", query: {} } },
    msw: {
      handlers: [
        http.get("/api/v1/evaluation/summary", () => HttpResponse.json(summary)),
        http.get("/api/v1/evaluation/conditions", () =>
          HttpResponse.json<Page<EvaluationCondition>>({
            items: [condition],
            total: 10030,
            limit: 50,
            offset: 0,
          }),
        ),
        http.get("/api/v1/evaluation/conditions/:taskKey", () => HttpResponse.json(detail)),
        http.get("/api/v1/evaluation/conditions/:taskKey/scene", () => HttpResponse.json(scene)),
        http.get(
          "/storybook-evaluation-geometry.glb",
          () =>
            new HttpResponse(evaluationGeometryGlb(), {
              headers: { "Content-Type": "model/gltf-binary" },
            }),
        ),
        http.get("/api/v1/task-families", () =>
          HttpResponse.json<Page<TaskFamily>>({
            items: [family],
            total: 40,
            limit: 130,
            offset: 0,
          }),
        ),
      ],
    },
  },
  decorators: [
    (Story) => (
      <main className="h-screen bg-base-200 p-6">
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof EvaluationPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MatrixAndDetail: Story = {
  parameters: { viewport: { defaultViewport: "desktop2k" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("heading", { name: "Condition matrix" })).toBeVisible();
    await expect(await canvas.findByTestId("evaluation-matrix")).toBeVisible();
    await expect(await canvas.findByText("Background Textures", { exact: true })).toBeVisible();
    await expect(
      await canvas.findByRole("heading", {
        name: "Please make sure the middle drawer of the cabinet is open",
      }),
    ).toBeVisible();
    await expect(await canvas.findByText("Official state index 0", { exact: false })).toBeVisible();
    const viewport = await canvas.findByTestId("evaluation-scene-viewport");
    await expect(viewport).toBeVisible();
    await expect(viewport).toHaveAttribute("data-texture-mapping", "mujoco-baked-uv");
    await waitFor(() => expect(viewport).toHaveAttribute("data-scene-state", "ready"), {
      timeout: 5_000,
    });
  },
};
