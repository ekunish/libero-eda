import { describe, expect, it } from "vitest";
import { validateHostedManifestUrl } from "./manifest-url";

const revision = "a".repeat(40);

describe("validateHostedManifestUrl", () => {
  it("accepts an immutable Hugging Face dataset revision", () => {
    const url = `https://huggingface.co/datasets/ekunish/libero-eda-data/resolve/${revision}/manifest.json`;
    expect(validateHostedManifestUrl(url)).toBe(url);
  });

  it("accepts an explicit loopback source for local integration tests", () => {
    expect(validateHostedManifestUrl("http://127.0.0.1:5602/hosted/manifest.json")).toBe(
      "http://127.0.0.1:5602/hosted/manifest.json",
    );
  });

  it.each([
    "https://huggingface.co/datasets/ekunish/libero-eda-data/resolve/main/manifest.json",
    `http://huggingface.co/datasets/ekunish/libero-eda-data/resolve/${revision}/manifest.json`,
    `https://example.com/datasets/ekunish/libero-eda-data/resolve/${revision}/manifest.json`,
    `https://huggingface.co/datasets/ekunish/libero-eda-data/resolve/${revision}/manifest.json?download=1`,
    "/manifest.json",
  ])("rejects an unpinned or untrusted production source: %s", (url) => {
    expect(() => validateHostedManifestUrl(url)).toThrow();
  });
});
