import type { Preview } from "@storybook/nextjs-vite";
import "@fontsource-variable/noto-sans-jp";
import { HttpResponse, http } from "msw";
import { mswLoader } from "msw-storybook-addon/csf3";
import { AppProviders } from "../src/_app/providers";
import "../app/globals.css";

globalThis.__LIBERO_EDA_MOCK_API__ = true;

const preview: Preview = {
  decorators: [
    (Story, context) => (
      <AppProviders>
        <div
          data-theme="light"
          className={
            context.parameters.layout === "fullscreen"
              ? "min-h-screen bg-base-200 text-base-content"
              : "min-h-[28rem] bg-base-200 p-6 text-base-content"
          }
        >
          <Story />
        </div>
      </AppProviders>
    ),
  ],
  loaders: [mswLoader()],
  parameters: {
    layout: "centered",
    nextjs: { appDirectory: true },
    a11y: { test: "error" },
    viewport: {
      options: {
        tablet834: {
          name: "Tablet 834 × 1194",
          styles: { width: "834px", height: "1194px" },
          type: "tablet",
        },
        desktop2k: {
          name: "2K 2048 × 1152",
          styles: { width: "2048px", height: "1152px" },
          type: "desktop",
        },
        desktop2560: {
          name: "Desktop 2560 × 1440",
          styles: { width: "2560px", height: "1440px" },
          type: "desktop",
        },
      },
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    options: {
      storySort: {
        order: ["Foundations", "Shared", "Features", "Widgets", "Pages"],
      },
    },
    msw: {
      handlers: [
        http.get("/api/v1/health", () =>
          HttpResponse.json({ status: "ok", database_ready: true, dataset_ready: true }),
        ),
      ],
    },
  },
  tags: ["autodocs", "test"],
};

export default preview;
