import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type VercelConfig = {
  headers: Array<{
    headers: Array<{ key: string; value: string }>;
  }>;
};

describe("Vercel Content Security Policy", () => {
  it("allows the GLTF decoder and its in-memory texture URLs", () => {
    const config = JSON.parse(
      readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as VercelConfig;
    const policy = config.headers
      .flatMap((route) => route.headers)
      .find((header) => header.key === "Content-Security-Policy")?.value;

    expect(policy).toContain("connect-src 'self' blob:");
    expect(policy).toContain("script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'");
  });
});
