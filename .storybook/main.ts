import type { StorybookConfig } from "@storybook/nextjs-vite";
import { mergeConfig } from "vite";

const config = {
  stories: ["../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: [
    "@storybook/addon-docs",
    "@storybook/addon-a11y",
    "@storybook/addon-vitest",
    "msw-storybook-addon",
  ],
  framework: {
    name: "@storybook/nextjs-vite",
    options: {},
  },
  staticDirs: ["../public"],
  viteFinal: async (viteConfig) =>
    mergeConfig(viteConfig, {
      optimizeDeps: {
        include: [
          "@react-three/drei",
          "@react-three/fiber",
          "three",
          "three/addons/objects/Reflector.js",
          "zustand",
        ],
      },
    }),
} satisfies StorybookConfig;

export default config;
