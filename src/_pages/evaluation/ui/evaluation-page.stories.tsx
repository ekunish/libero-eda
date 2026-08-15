import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { HttpResponse, http } from "msw";
import { expect, within } from "storybook/test";
import type {
  EvaluationCondition,
  EvaluationConditionDetail,
  EvaluationSummary,
  Page,
  TaskFamily,
} from "@/shared/api";
import EvaluationPage from "./evaluation-page";

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
  categories: ["Language Instructions", "Sensor Noise"],
  difficulty_levels: [1, 2, 3, 4, 5],
  unassigned_difficulty_count: 121,
  suites: [{ suite: "libero_goal", count: 2591 }],
  matrix: [
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
    await expect(
      await canvas.findByRole("heading", {
        name: "Please make sure the middle drawer of the cabinet is open",
      }),
    ).toBeVisible();
    await expect(
      await canvas.findByText("Evaluation definitions do not include official videos", {
        exact: false,
      }),
    ).toBeVisible();
  },
};
