"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(min-width: 1280px)";

function subscribe(callback: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function snapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

export function useDesktopWorkspace(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
