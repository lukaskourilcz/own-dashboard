"use client";

import { useMemo, useSyncExternalStore } from "react";

/**
 * When a press-to-load destination (Opportunities) was last loaded in this
 * browser session, and what it held then. Stored in sessionStorage so the
 * gate can show "last loaded" and the counts without fetching anything.
 */
export type LastLoad = { at: string; counts: Record<string, number> };

const listeners = new Set<() => void>();
const storageKey = (scope: string) => `on-demand-load:${scope}`;

function read(scope: string): string | null {
  try {
    return window.sessionStorage.getItem(storageKey(scope));
  } catch {
    return null;
  }
}

export function recordLastLoad(scope: string, counts: Record<string, number>): void {
  try {
    window.sessionStorage.setItem(storageKey(scope), JSON.stringify({ at: new Date().toISOString(), counts }));
  } catch {
    // Storage disabled: the gate simply shows "not loaded in this session".
  }
  for (const listener of listeners) listener();
}

export function parseLastLoad(raw: string | null): LastLoad | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LastLoad>;
    if (typeof value.at !== "string" || Number.isNaN(Date.parse(value.at))) return null;
    const counts = Object.fromEntries(
      Object.entries(value.counts ?? {}).filter((entry): entry is [string, number] => Number.isFinite(entry[1])),
    );
    return { at: value.at, counts };
  } catch {
    return null;
  }
}

export function useLastLoad(scope: string): LastLoad | null {
  const raw = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => read(scope),
    () => null,
  );
  return useMemo(() => parseLastLoad(raw), [raw]);
}
