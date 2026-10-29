"use client";

import { useMemo, useSyncExternalStore } from "react";
import { subscribeStoredPreference } from "@/lib/preference-storage";

const KEY = "visibleRepoIds";
const listeners = new Set<() => void>();
const EMPTY: readonly string[] = Object.freeze([]);
type Snapshot = { kind: "ok"; ids: readonly string[] } | { kind: "missing" | "unavailable" | "invalid" };
const MISSING: Snapshot = { kind: "missing" }, UNAVAILABLE: Snapshot = { kind: "unavailable" }, INVALID: Snapshot = { kind: "invalid" };
let cached: Snapshot | undefined;
let revision = 0;

export function parseRepositoryFilter(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 500 || value.some(id => typeof id !== "string" || !/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id)))) return null;
  return [...new Set(value)] as string[];
}
function read(): Snapshot {
  if (typeof window === "undefined") return MISSING;
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return cached = MISSING;
    if (raw.length > 10_000) return cached = INVALID;
    const ids = parseRepositoryFilter(JSON.parse(raw));
    return cached = ids ? { kind: "ok", ids: Object.freeze(ids) } : INVALID;
  } catch { return cached = UNAVAILABLE; }
}
const serverSnapshot = () => MISSING;
const subscribe = (callback: () => void) => subscribeStoredPreference(KEY, listeners, callback, () => { cached = undefined; revision++; });
export const repositoryFilterRevision = () => revision;
export const beginRepositoryFilterIntent = () => ++revision;

export function readRepoFilter(): string[] | null {
  const snapshot = read();
  return snapshot.kind === "ok" ? [...snapshot.ids] : null;
}

/** An unconfirmed storage failure must not enable a new repository selection.
 * A caller with a confirmed server receipt may retain it in memory instead. */
export function writeRepoFilter(ids: readonly string[], { allowMemoryFallback = false, expectedRevision }: { allowMemoryFallback?: boolean; expectedRevision?: number } = {}): boolean {
  const parsed = parseRepositoryFilter(ids);
  if (!parsed || typeof window === "undefined" || (expectedRevision !== undefined && expectedRevision !== revision)) return false;
  let persisted = false;
  try {
    const encoded = JSON.stringify(parsed);
    localStorage.setItem(KEY, encoded);
    persisted = localStorage.getItem(KEY) === encoded;
  } catch { /* Reported to the caller. */ }
  if (persisted || allowMemoryFallback) {
    cached = { kind: "ok", ids: Object.freeze(parsed) };
    revision++;
    for (const listener of listeners) listener();
  }
  return persisted;
}

export function useRepositoryFilter(initialIds: readonly string[] = EMPTY, serverAvailable = true) {
  const snapshot = useSyncExternalStore(subscribe, read, serverSnapshot);
  const fallback = useMemo(() => parseRepositoryFilter(initialIds), [initialIds]);
  return {
    ids: snapshot.kind === "ok" ? snapshot.ids : serverAvailable ? fallback ?? EMPTY : EMPTY,
    available: snapshot.kind === "ok" || (serverAvailable && fallback !== null),
  };
}
