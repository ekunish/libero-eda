import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.LIBERO_EDA_E2E_BASE_URL ?? "http://127.0.0.1:5602";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "tablet",
      use: { ...devices["iPad Pro 11"], browserName: "chromium" },
    },
  ],
});
