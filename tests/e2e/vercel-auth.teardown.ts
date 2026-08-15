import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const protectionStatePath = resolve(".vercel/playwright-auth.json");

export default async function vercelAuthTeardown() {
  await rm(protectionStatePath, { force: true });
}
