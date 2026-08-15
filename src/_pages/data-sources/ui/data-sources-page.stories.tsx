import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { HttpResponse, http } from "msw";
import { expect, within } from "storybook/test";
import type { DataSourceRegistry } from "@/shared/api";
import DataSourcesPage from "./data-sources-page";

const registry: DataSourceRegistry = {
  groups: [
    {
      group_id: "original_libero",
      title: "Original LIBERO",
      purpose: "Source task definitions and official demonstrations",
      sources: [
        {
          source_id: "original_libero_demonstrations",
          role: "recorded_trajectories",
          label: "yifengzhu-hf/LIBERO-datasets",
          repository: "yifengzhu-hf/LIBERO-datasets",
          revision: "f13aa24a3da8c43c7225569f28c562979fa0e35a",
          url: "https://huggingface.co/datasets/yifengzhu-hf/LIBERO-datasets",
          structure: ["130 HDF5 task files", "50 demonstrations per task"],
          counts: { tasks: 130, episodes: 6500, frames: 1007618 },
        },
      ],
    },
  ],
};

const meta = {
  title: "Pages/Data Sources",
  component: DataSourcesPage,
  parameters: {
    layout: "fullscreen",
    nextjs: { navigation: { pathname: "/sources", query: {} } },
    msw: { handlers: [http.get("/api/v1/data-sources", () => HttpResponse.json(registry))] },
  },
  decorators: [
    (Story) => (
      <main className="h-screen bg-base-200 p-6">
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof DataSourcesPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UsedSourcesOnly: Story = {
  parameters: { viewport: { defaultViewport: "desktop2k" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("heading", { name: "yifengzhu-hf/LIBERO-datasets" }),
    ).toBeVisible();
    await expect((await canvas.findAllByText("6,500"))[0]).toBeVisible();
  },
};
