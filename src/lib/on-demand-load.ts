"use client";

import { useMemo, useSyncExternalStore } from "react";

/** Session-only load metadata. Callers include the owner or explicit preview
 * namespace; legacy unscoped records are never moved into another scope. */
export type LastLoad = { at: string; counts: Record<string, number> };
const MAX_RAW = 4096;
const listeners = new Set<() => void>();
const validScope = (scope: string) => /^(?:owner:[A-Za-z0-9_-]{1,128}|preview):[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(scope);
const storageKey = (scope: string) => `on-demand-load:${scope}`;
function read(scope: string): string | null {
  if (!validScope(scope)) return null;
  try { const raw = window.sessionStorage.getItem(storageKey(scope)); return raw && raw.length <= MAX_RAW ? raw : null; } catch { return null; }
}
function boundedCounts(input: unknown): Record<string, number> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const entries = Object.entries(input);
  if (entries.length > 20 || entries.some(([key, value]) => !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) || !Number.isSafeInteger(value) || (value as number) < 0)) return null;
  return Object.fromEntries(entries);
}
function notify() { for (const listener of listeners) listener(); }
function onStorage(event: StorageEvent) {
  try { if (event.storageArea && event.storageArea !== window.sessionStorage) return; } catch { return; }
  if (event.key === null || event.key.startsWith("on-demand-load:")) notify();
}
function subscribe(listener: () => void) {
  if (listeners.size === 0) { window.addEventListener("storage", onStorage); window.addEventListener("pageshow", notify); }
  listeners.add(listener);
  return () => { listeners.delete(listener); if (listeners.size === 0) { window.removeEventListener("storage", onStorage); window.removeEventListener("pageshow", notify); } };
}
export function recordLastLoad(scope: string, counts: Record<string, number>): void {
  const checked = boundedCounts(counts);
  if (!validScope(scope) || !checked) return;
  try { window.sessionStorage.setItem(storageKey(scope), JSON.stringify({ at: new Date().toISOString(), counts: checked })); } catch { /* Optional session metadata. */ }
  notify();
}
function parseLastLoad(raw: string | null): LastLoad | null {
  if (!raw || raw.length > MAX_RAW) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const entry = value as Record<string, unknown>, keys = Object.keys(entry);
    if (keys.length !== 2 || !keys.includes("at") || !keys.includes("counts") || typeof entry.at !== "string" || entry.at.length > 30
      || !Number.isFinite(Date.parse(entry.at)) || new Date(entry.at).toISOString() !== entry.at) return null;
    const counts = boundedCounts(entry.counts); return counts ? { at: entry.at, counts } : null;
  } catch { return null; }
}
const serverSnapshot = () => null;
export function useLastLoad(scope: string): LastLoad | null {
  const raw = useSyncExternalStore(subscribe, () => read(scope), serverSnapshot);
  return useMemo(() => parseLastLoad(raw), [raw]);
}
