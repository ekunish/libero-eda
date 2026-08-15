import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Activity, Database, Search, TriangleAlert } from "lucide-react";
import { expect, fn, userEvent, within } from "storybook/test";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorPanel,
  IconButton,
  Input,
  Select,
  Skeleton,
} from "./primitives";

const primaryAction = fn();
const searchAction = fn();

const meta = {
  title: "Foundations/Interface kit",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Controls: Story = {
  render: () => (
    <Card className="w-full max-w-3xl p-6">
      <p className="eyebrow">Controls</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={primaryAction}>
          Run evaluation
        </Button>
        <Button variant="accent">Open source</Button>
        <Button>Inspect task</Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="danger">Stop playback</Button>
        <Button disabled>Unavailable</Button>
      </div>
      <div className="mt-7 flex flex-wrap items-center gap-2">
        <Badge>baseline</Badge>
        <Badge tone="cyan">replay</Badge>
        <Badge tone="green">succeeded</Badge>
        <Badge tone="amber">queued</Badge>
        <Badge tone="red">failed</Badge>
        <Badge tone="violet">background × light</Badge>
      </div>
      <div className="mt-7 grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
        <Input aria-label="Search tasks" placeholder="Search tasks" />
        <Select aria-label="Task suite" defaultValue="spatial">
          <option value="spatial">Spatial</option>
          <option value="object">Object</option>
        </Select>
        <IconButton aria-label="Search" variant="ghost" onClick={searchAction}>
          <Search size={14} />
        </IconButton>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Input aria-label="Invalid directory" aria-invalid placeholder="Invalid directory" />
        <Select aria-label="Unavailable suite" disabled defaultValue="spatial">
          <option value="spatial">Spatial</option>
        </Select>
      </div>
    </Card>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    primaryAction.mockClear();
    searchAction.mockClear();
    await userEvent.click(canvas.getByRole("button", { name: "Run evaluation" }));
    await expect(primaryAction).toHaveBeenCalledOnce();
    await userEvent.click(canvas.getByRole("button", { name: "Search" }));
    await expect(searchAction).toHaveBeenCalledOnce();
    await userEvent.click(canvas.getByLabelText("Search tasks"));
    await expect(canvas.getByLabelText("Search tasks")).toHaveFocus();
    await userEvent.selectOptions(canvas.getByLabelText("Task suite"), "object");
    await expect(canvas.getByLabelText("Task suite")).toHaveValue("object");
    await expect(canvas.getByLabelText("Unavailable suite")).toBeDisabled();
  },
};

export const Feedback: Story = {
  render: () => (
    <div className="grid w-full max-w-4xl gap-4 lg:grid-cols-2">
      <EmptyState
        icon={<Database />}
        title="No replay artifacts"
        body="Recorded video and trajectories share a synchronized timeline."
      />
      <ErrorPanel
        title="Catalog scan failed"
        error={new Error("manifest.json is required; the scan stopped without a fallback")}
      />
      <Card className="p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Activity size={16} /> Loading trajectory
        </div>
        <div className="mt-5 space-y-3">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-28 w-full" />
        </div>
      </Card>
      <div className="alert alert-warning alert-soft rounded-box">
        <TriangleAlert size={18} />
        <span className="text-sm">One run has no digital-twin asset.</span>
      </div>
    </div>
  ),
};
