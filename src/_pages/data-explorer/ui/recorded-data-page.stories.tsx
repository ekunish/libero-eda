import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { delay, HttpResponse, http } from "msw";
import { expect, fireEvent, within } from "storybook/test";
import type {
  EpisodeRecord,
  Page,
  TaskEpisodes,
  TaskFamily,
  TrainingEnvironmentCategories,
} from "@/shared/api";
import RecordedDataPage from "./recorded-data-page";

const family: TaskFamily = {
  task_key: "libero:libero_spatial:1",
  source: "libero",
  suite: "libero_spatial",
  suite_id: 1,
  name: "pick_up_the_black_bowl",
  instruction: "pick up the black bowl and place it on the plate",
  scene: "KITCHEN_SCENE1",
  original_collection: "libero_spatial",
  original_split: null,
  is_plus_source: true,
  changed_variant_count: 248,
  matching_variant_count: 248,
  matching_difficulty_levels: [1, 2, 3, 4, 5],
  matching_unlabeled_difficulty_count: 0,
  compatibility_entry_count: 0,
  t1_variant_count: 0,
  t1_ordinals: [],
  recording_sets: [
    {
      dataset_id: "original_libero",
      display_name: "Original LIBERO official demonstrations",
      availability: "available",
      episode_count: 50,
      expected_episode_count: 50,
      frame_count: 6_000,
      mean_episode_length: 120,
      digital_twin_available: true,
    },
    {
      dataset_id: "lerobot_libero_plus",
      display_name: "LIBERO-Plus training trajectories",
      availability: "available",
      episode_count: 346,
      expected_episode_count: null,
      frame_count: 52_000,
      mean_episode_length: 150,
      digital_twin_available: false,
    },
  ],
};

const families: Page<TaskFamily> = { items: [family], total: 130, limit: 130, offset: 0 };
const originalEpisode: EpisodeRecord = {
  episode_index: 0,
  source_episode_id: "0",
  dataset_id: "original_libero",
  dataset_name: "Original LIBERO official demonstrations",
  task_index: 0,
  task_instruction: family.instruction,
  original_task_instruction: family.instruction,
  base_task_key: family.task_key,
  suite: family.suite,
  length: 120,
  duration_sec: 6,
  replay_id: "original-demo-0",
  training_environment_category: null,
  training_environment_strength: null,
  training_environment_strength_status: "not_applicable",
  training_instruction: null,
  training_instruction_source: null,
  training_instruction_availability: "not_applicable",
  training_instruction_relation: "not_applicable",
};
const episodes: TaskEpisodes = {
  items: [originalEpisode],
  total: 50,
  limit: 50,
  offset: 0,
  dataset_id: "original_libero",
  dataset_name: "Original LIBERO official demonstrations",
  availability: "available",
  relationship: "recorded_for_task",
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
  recorded_task_key: family.task_key,
  lineage_task_key: family.task_key,
};

const plusEpisodes: TaskEpisodes = {
  ...episodes,
  items: [
    {
      ...originalEpisode,
      episode_index: 99,
      source_episode_id: "99",
      dataset_id: "lerobot_libero_plus",
      dataset_name: "LIBERO-Plus training records",
      replay_id: "demo-99",
      training_environment_category: "camera_view",
      training_environment_strength_status: "not_published",
      training_instruction: family.instruction,
      training_instruction_source: "official_rlds.steps/language_instruction",
      training_instruction_availability: "published",
      training_instruction_relation: "same_as_original_task",
    },
  ],
  total: 346,
  dataset_id: "lerobot_libero_plus",
  dataset_name: "LIBERO-Plus training records",
};

const categories: TrainingEnvironmentCategories = {
  dataset_id: "lerobot_libero_plus",
  display_name: "LIBERO-Plus training records",
  source_namespace: "official_rlds_episode_metadata.file_path",
  base_task_key: family.task_key,
  strength_availability: "not_published",
  items: [{ category: "camera_view", episode_count: 70 }],
  training_instruction: {
    availability: "published",
    source_feature: "official_rlds.steps/language_instruction",
  },
  training_instruction_relations: [{ relation: "same_as_original_task", episode_count: 346 }],
};

const previewSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <rect width="128" height="128" fill="#d8d1c5" />
    <rect x="16" y="60" width="96" height="44" rx="5" fill="#8e6e4c" />
    <circle cx="64" cy="68" r="22" fill="#20242a" />
  </svg>
`;

const dataHandlers = [
  http.get("/api/v1/task-families", () => HttpResponse.json(families)),
  http.get("/api/v1/tasks/:taskKey/episodes", ({ request }) => {
    const dataset = new URL(request.url).searchParams.get("dataset_id");
    return HttpResponse.json(dataset === "lerobot_libero_plus" ? plusEpisodes : episodes);
  }),
  http.get("/api/v1/datasets/lerobot_libero_plus/training-environment-categories", () =>
    HttpResponse.json(categories),
  ),
];

const thumbnailHandler = http.get(
  "/api/v1/replays/:replayId/thumbnail",
  () =>
    new HttpResponse(previewSvg, {
      headers: { "Content-Type": "image/svg+xml" },
    }),
);

const meta = {
  title: "Pages/Recorded Data",
  component: RecordedDataPage,
  parameters: {
    layout: "fullscreen",
    nextjs: { navigation: { pathname: "/data", query: {} } },
    msw: { handlers: { data: dataHandlers, thumbnail: thumbnailHandler } },
  },
  decorators: [
    (Story) => (
      <main className="h-screen bg-base-200 p-6">
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof RecordedDataPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OriginalLibero: Story = {
  parameters: { viewport: { defaultViewport: "desktop2k" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect((await canvas.findAllByText(family.instruction))[0]).toBeVisible();
    await expect(await canvas.findByRole("group", { name: "Recorded dataset" })).toBeVisible();
    await expect(await canvas.findByRole("link", { name: /Replay/ })).toBeVisible();
    const preview = await canvas.findByRole("img", { name: /Front preview/ });
    await fireEvent.load(preview);
    const thumbnail = canvas.getByTestId("episode-thumbnail-original-demo-0");
    await expect(thumbnail).toBeVisible();
    await expect(thumbnail).toHaveAttribute("data-status", "ready");
    const root = canvasElement.ownerDocument.documentElement;
    await expect(root.scrollWidth - root.clientWidth).toBeLessThanOrEqual(1);
  },
};

export const LiberoPlusTraining: Story = {
  parameters: {
    viewport: { defaultViewport: "desktop2k" },
    nextjs: {
      navigation: {
        pathname: "/data",
        query: { dataset: "lerobot_libero_plus", task: family.task_key },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("button", { name: /LIBERO-Plus Training/ }),
    ).toHaveAttribute("aria-pressed", "true");
    const preview = await canvas.findByRole("img", { name: /Dataset episode #99/ });
    await fireEvent.load(preview);
    await expect(canvas.getByTestId("episode-thumbnail-demo-99")).toBeVisible();
    await expect(canvas.getByText("camera_view / camera views")).toBeVisible();
  },
};

export const ThumbnailLoading: Story = {
  parameters: {
    viewport: { defaultViewport: "desktop2k" },
    msw: {
      handlers: {
        data: dataHandlers,
        thumbnail: http.get("/api/v1/replays/:replayId/thumbnail", async () => {
          await delay("infinite");
          return new HttpResponse(null, { status: 204 });
        }),
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("episode-thumbnail-original-demo-0")).toHaveAttribute(
      "data-status",
      "loading",
    );
  },
};

export const ThumbnailUnavailable: Story = {
  parameters: {
    viewport: { defaultViewport: "desktop2k" },
    msw: {
      handlers: {
        data: dataHandlers,
        thumbnail: http.get(
          "/api/v1/replays/:replayId/thumbnail",
          () => new HttpResponse(null, { status: 409 }),
        ),
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await fireEvent.error(await canvas.findByRole("img", { name: /Front preview/ }));
    await expect(await canvas.findByText("Preview unavailable")).toBeVisible();
    await expect(canvas.getByTestId("episode-thumbnail-original-demo-0")).toHaveAttribute(
      "data-status",
      "error",
    );
  },
};

export const TabletRecordSheet: Story = {
  parameters: {
    viewport: { defaultViewport: "tablet834" },
    nextjs: {
      navigation: {
        pathname: "/data",
        query: { task: family.task_key, sheet: "recording" },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = await body.findByRole("dialog", { name: "Selected task records" });
    await expect(dialog).toBeVisible();
    const preview = await within(dialog).findByRole("img", { name: /Front preview/ });
    await fireEvent.load(preview);
    await expect(within(dialog).getByTestId("episode-thumbnail-original-demo-0")).toBeVisible();
    const root = canvasElement.ownerDocument.documentElement;
    await expect(root.scrollWidth - root.clientWidth).toBeLessThanOrEqual(1);
  },
};
