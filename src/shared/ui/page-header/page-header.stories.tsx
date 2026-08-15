import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Download, Play } from "lucide-react";
import { Button } from "@/shared/ui/primitives";
import { PageHeader } from "./page-header";

const meta = {
  title: "Shared/Page header",
  component: PageHeader,
  args: {
    eyebrow: "Matched episodes",
    title: "Run comparison",
    description: "Inspect synchronized video, trajectory, and task metadata in a single workspace.",
  },
  parameters: { layout: "padded" },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithActions: Story = {
  args: {
    actions: (
      <>
        <Button size="sm">
          <Download size={14} /> Export
        </Button>
        <Button size="sm" variant="primary">
          <Play size={14} /> Open replay
        </Button>
      </>
    ),
  },
};
