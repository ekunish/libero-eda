"use client";

import { useCallback, useSyncExternalStore } from "react";

export function useDesktopWorkspace(minWidth = 1280): boolean {
  const query = `(min-width: ${minWidth}px)`;
  const subscribe = useCallback(
    (callback: () => void): (() => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", callback);
      return () => media.removeEventListener("change", callback);
    },
    [query],
  );
  const snapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
