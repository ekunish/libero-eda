import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { type FullConfig, request } from "@playwright/test";

const protectionStatePath = resolve(".vercel/playwright-auth.json");

export default async function vercelAuthSetup(config: FullConfig) {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!secret) return;

  const baseURL = config.projects[0]?.use.baseURL;
  if (typeof baseURL !== "string") {
    throw new Error("A Playwright baseURL is required for Vercel preview authentication.");
  }

  await mkdir(dirname(protectionStatePath), { recursive: true });
  await rm(protectionStatePath, { force: true });
  const authRequest = await request.newContext({ baseURL });
  try {
    const response = await authRequest.get("/", {
      headers: {
        "x-vercel-protection-bypass": secret,
        "x-vercel-set-bypass-cookie": "true",
      },
    });
    if (!response.ok()) {
      throw new Error(`Vercel preview authentication failed with HTTP ${response.status()}.`);
    }

    const state = await authRequest.storageState({ path: protectionStatePath });
    if (state.cookies.length === 0) {
      throw new Error("Vercel preview authentication did not issue a bypass cookie.");
    }
    await chmod(protectionStatePath, 0o600);
  } finally {
    await authRequest.dispose();
  }
}
