"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_LAYOUT,
  normalizeLayout,
  type WidgetId,
} from "@/lib/dashboard-layout";

/**
 * Device-local persistence for the overview's widget layout, following the
 * same localStorage + useSyncExternalStore pattern as use-prefs.ts. The
 * arrangement is a per-device preference and intentionally not synced to the
 * server.
 */

const LAYOUT_KEY = "dashboardLayout";
const listeners = new Set<() => void>();
let cache: readonly WidgetId[] | null = null;

// Stable reference for SSR / first client render so useSyncExternalStore can
// hand back a cached snapshot without tearing.
const SERVER_SNAPSHOT: readonly WidgetId[] = DEFAULT_LAYOUT;

function read(): readonly WidgetId[] {
  if (cache != null) return cache;
  if (typeof window === "undefined") return SERVER_SNAPSHOT;
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    cache = raw ? normalizeLayout(JSON.parse(raw)) : [...DEFAULT_LAYOUT];
  } catch {
    cache = [...DEFAULT_LAYOUT];
  }
  return cache;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const getServerSnapshot = (): readonly WidgetId[] => SERVER_SNAPSHOT;

function write(next: readonly WidgetId[]): void {
  cache = [...next];
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(cache));
  } catch {
    // ignore — private mode / quota
  }
  for (const cb of listeners) cb();
}

export function useDashboardLayout(): {
  layout: readonly WidgetId[];
  setLayout: (next: readonly WidgetId[]) => void;
  reset: () => void;
} {
  const layout = useSyncExternalStore(subscribe, read, getServerSnapshot);
  return {
    layout,
    setLayout: write,
    reset: () => write(DEFAULT_LAYOUT),
  };
}
