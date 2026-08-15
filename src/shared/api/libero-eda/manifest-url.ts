const PINNED_HUB_MANIFEST = /^\/datasets\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\/manifest\.json$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function validateHostedManifestUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The hosted data manifest must be an absolute URL.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("The hosted data manifest URL must not contain credentials, query, or hash.");
  }
  if (LOOPBACK_HOSTS.has(url.hostname) && ["http:", "https:"].includes(url.protocol)) {
    return url.toString();
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "huggingface.co" ||
    !PINNED_HUB_MANIFEST.test(url.pathname)
  ) {
    throw new Error(
      "Production data must use a pinned Hugging Face manifest URL with a 40-character commit revision.",
    );
  }
  return url.toString();
}
