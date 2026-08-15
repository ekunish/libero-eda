import type { ReplayManifest } from "@/shared/api";

export const REPLAY_CONTEXT_LIMIT = 50;
export const replayKeys = {
  scope: "replay_scope",
  q: "replay_q",
  series: "replay_series",
  outcome: "replay_outcome",
  offset: "replay_offset",
} as const;

const replayReturnPaths = new Set(["/data", "/evaluation", "/sources"]);

export type ReplayQueryState = {
  scope: "auto" | "task" | "dataset" | "run";
  q: string;
  series: string;
  outcome: "all" | "success" | "failure";
  offset: number | null;
};

type ReadonlyURLSearchParams = Pick<URLSearchParams, "get">;
type ReplaySource = Pick<ReplayManifest, "source" | "dataset_id">;

export function replayQueryState(params: ReadonlyURLSearchParams): ReplayQueryState {
  const rawScope = params.get(replayKeys.scope);
  const scope =
    rawScope === "task" || rawScope === "dataset" || rawScope === "run" ? rawScope : "auto";
  const rawOutcome = params.get(replayKeys.outcome);
  const outcome = rawOutcome === "success" || rawOutcome === "failure" ? rawOutcome : "all";
  const rawOffset = params.get(replayKeys.offset);
  const parsedOffset = rawOffset != null && /^\d+$/.test(rawOffset) ? Number(rawOffset) : null;
  return {
    scope,
    q: params.get(replayKeys.q)?.trim() ?? "",
    series: params.get(replayKeys.series)?.trim() ?? "",
    outcome,
    offset: parsedOffset != null && Number.isSafeInteger(parsedOffset) ? parsedOffset : null,
  };
}

export function sanitizeReplayParams(
  params: URLSearchParams,
  replay: ReplaySource,
): URLSearchParams {
  const next = new URLSearchParams(params);
  const rawScope = next.get(replayKeys.scope);
  const validScope = ["auto", "task", "dataset", "run"].includes(rawScope ?? "auto");
  if (!validScope) next.delete(replayKeys.scope);

  if (replay.source === "dataset") {
    if (rawScope === "run") next.set(replayKeys.scope, "task");
    next.delete(replayKeys.outcome);
    if (replay.dataset_id !== "lerobot_libero_plus") next.delete(replayKeys.series);
  } else {
    if (rawScope === "task" || rawScope === "dataset") next.set(replayKeys.scope, "run");
    next.delete(replayKeys.series);
  }

  const q = next.get(replayKeys.q)?.trim() ?? "";
  if (q) next.set(replayKeys.q, q);
  else next.delete(replayKeys.q);

  const series = next.get(replayKeys.series)?.trim() ?? "";
  if (series) next.set(replayKeys.series, series);
  else next.delete(replayKeys.series);

  const outcome = next.get(replayKeys.outcome);
  if (outcome !== "success" && outcome !== "failure") next.delete(replayKeys.outcome);

  const rawOffset = next.get(replayKeys.offset);
  const parsedOffset = rawOffset != null && /^\d+$/.test(rawOffset) ? Number(rawOffset) : null;
  if (parsedOffset == null || !Number.isSafeInteger(parsedOffset) || parsedOffset <= 0) {
    next.delete(replayKeys.offset);
  } else {
    const normalizedOffset = Math.floor(parsedOffset / REPLAY_CONTEXT_LIMIT) * REPLAY_CONTEXT_LIMIT;
    if (normalizedOffset > 0) next.set(replayKeys.offset, String(normalizedOffset));
    else next.delete(replayKeys.offset);
  }
  return next;
}

export function replayContextPath(replayId: string, params: URLSearchParams): string {
  const state = replayQueryState(params);
  const query = new URLSearchParams({ scope: state.scope, limit: String(REPLAY_CONTEXT_LIMIT) });
  if (state.q) query.set("q", state.q);
  if (state.series) query.set("training_environment_category", state.series);
  if (state.outcome !== "all") query.set("outcome", state.outcome);
  if (state.offset != null) query.set("offset", String(state.offset));
  return `/replays/${encodeURIComponent(replayId)}/context?${query}`;
}

export function replayHref(replayId: string, params: URLSearchParams, anchor = false): string {
  const query = new URLSearchParams(params);
  query.set("replay_id", replayId);
  if (anchor) query.delete(replayKeys.offset);
  return `/replay/?${query}`;
}

export function safeReplayReturnPath(value: string | null): string | null {
  if (!value?.startsWith("/") || value.startsWith("//")) return null;
  let parsed: URL;
  try {
    parsed = new URL(value, "http://libero-eda.local");
  } catch {
    return null;
  }
  if (parsed.origin !== "http://libero-eda.local" || !replayReturnPaths.has(parsed.pathname)) {
    return null;
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
