import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Activity, Database, Route } from "lucide-react";
import { Card } from "@/shared/ui/primitives";
import { AppShell } from "./app-shell";

const meta = {
  title: "Widgets/App shell",
  component: AppShell,
  parameters: {
    layout: "fullscreen",
    nextjs: { navigation: { pathname: "/data" } },
  },
} satisfies Meta<typeof AppShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  args: {
    children: (
      <div className="space-y-6">
        <header className="border-b border-base-300 pb-5">
          <p className="eyebrow">Storybook fixture</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">LIBERO data</h1>
          <p className="mt-2 text-sm text-base-content/65">
            Shell navigation, density, and health state can be inspected in isolation.
          </p>
        </header>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { icon: Database, label: "Recorded datasets", value: "02" },
            { icon: Route, label: "Task families", value: "130" },
            { icon: Activity, label: "Evaluation categories", value: "07" },
          ].map((item) => (
            <Card key={item.label} className="p-5">
              <item.icon size={17} className="text-primary" />
              <p className="mt-5 text-xs text-base-content/65">{item.label}</p>
              <p className="metric-value mt-1 text-3xl font-semibold">{item.value}</p>
            </Card>
          ))}
        </div>
      </div>
    ),
  },
};
