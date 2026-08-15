import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { LegalPage, LegalSection } from "./legal-page";

const meta = {
  title: "Shared/Legal page",
  component: LegalPage,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LegalPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PrivacyNotice: Story = {
  args: {
    title: "Privacy Notice",
    description: "How the public research explorer handles technical data.",
    children: (
      <LegalSection title="Local display preferences">
        <p>Replay orientation preferences stay in your browser.</p>
      </LegalSection>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Privacy Notice" })).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Local display preferences" })).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Back to LIBERO EDA" })).toHaveAttribute(
      "href",
      "/data/",
    );
  },
};
