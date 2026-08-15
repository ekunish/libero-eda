import { addons } from "storybook/manager-api";
import { liberoTheme } from "./theme";

addons.setConfig({
  theme: liberoTheme,
  sidebar: {
    showRoots: true,
  },
});
