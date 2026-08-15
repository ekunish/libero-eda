import fsd from "@feature-sliced/steiger-plugin";
import { defineConfig } from "steiger";

export default defineConfig([
  ...fsd.configs.recommended,
  {
    files: ["./src/_app/**", "./src/_pages/**"],
    rules: {
      // Next.js owns the root app directory; FSD recommends underscored layer aliases.
      "fsd/typo-in-layer-name": "off",
    },
  },
  {
    files: ["./src/features/**", "./src/widgets/**"],
    rules: {
      // App-shell entrypoints live outside src and focused one-consumer slices are intentional.
      "fsd/insignificant-slice": "off",
    },
  },
]);
