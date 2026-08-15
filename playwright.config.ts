import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.LIBERO_EDA_E2E_BASE_URL ?? "http://127.0.0.1:5602";
const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const protectionStatePath = ".vercel/playwright-auth.json";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  ...(protectionBypass
    ? {
        globalSetup: "./tests/e2e/vercel-auth.setup.ts",
        globalTeardown: "./tests/e2e/vercel-auth.teardown.ts",
      }
    : {}),
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...(protectionBypass ? { storageState: protectionStatePath } : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "tablet",
      use: { ...devices["iPad Pro 11"], browserName: "chromium" },
    },
  ],
});
