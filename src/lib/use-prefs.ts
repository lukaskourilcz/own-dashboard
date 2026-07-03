"use client";

import { useSyncExternalStore } from "react";

/**
 * Lightweight client-persisted UI preferences, following the same
 * localStorage + useSyncExternalStore pattern as `useTheme`
 * (see src/lib/use-theme.ts). These are device-local and intentionally not
 * synced to the server.
 */

// ---------------------------------------------------------------------------
// Display currency — what every total/chart is converted into.
// ---------------------------------------------------------------------------

export const DEFAULT_DISPLAY_CURRENCY = "CZK";

const CURRENCY_KEY = "displayCurrency";
const currencyListeners = new Set<() => void>();
let currencyCache: string | null = null;

function readCurrency(): string {
  if (currencyCache != null) return currencyCache;
  if (typeof window === "undefined") return DEFAULT_DISPLAY_CURRENCY;
  try {
    currencyCache = localStorage.getItem(CURRENCY_KEY) || DEFAULT_DISPLAY_CURRENCY;
  } catch {
    currencyCache = DEFAULT_DISPLAY_CURRENCY;
  }
  return currencyCache;
}

function subscribeCurrency(cb: () => void): () => void {
  currencyListeners.add(cb);
  return () => {
    currencyListeners.delete(cb);
  };
}

const getServerCurrency = (): string => DEFAULT_DISPLAY_CURRENCY;

export function useDisplayCurrency(): {
  currency: string;
  setCurrency: (next: string) => void;
} {
  const currency = useSyncExternalStore(
    subscribeCurrency,
    readCurrency,
    getServerCurrency,
  );
  const setCurrency = (next: string): void => {
    currencyCache = next;
    try {
      localStorage.setItem(CURRENCY_KEY, next);
    } catch {
      // ignore
    }
    for (const cb of currencyListeners) cb();
  };
  return { currency, setCurrency };
}

// ---------------------------------------------------------------------------
// Navigation visibility — which sections appear in the nav panel.
// Stored as the list of *hidden* section ids; empty means "show everything".
// ---------------------------------------------------------------------------

const HIDDEN_NAV_KEY = "hiddenNavSections";
const navListeners = new Set<() => void>();
const EMPTY_HIDDEN: readonly string[] = Object.freeze([]);
let hiddenCache: readonly string[] | null = null;

function readHidden(): readonly string[] {
  if (hiddenCache != null) return hiddenCache;
  if (typeof window === "undefined") return EMPTY_HIDDEN;
  try {
    const raw = localStorage.getItem(HIDDEN_NAV_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    hiddenCache = Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : EMPTY_HIDDEN;
  } catch {
    hiddenCache = EMPTY_HIDDEN;
  }
  return hiddenCache;
}

function subscribeHidden(cb: () => void): () => void {
  navListeners.add(cb);
  return () => {
    navListeners.delete(cb);
  };
}

const getServerHidden = (): readonly string[] => EMPTY_HIDDEN;

export function useNavVisibility(): {
  hidden: readonly string[];
  isHidden: (id: string) => boolean;
  toggle: (id: string) => void;
  setHidden: (next: string[]) => void;
} {
  const hidden = useSyncExternalStore(
    subscribeHidden,
    readHidden,
    getServerHidden,
  );
  const setHidden = (next: string[]): void => {
    hiddenCache = Object.freeze([...next]);
    try {
      localStorage.setItem(HIDDEN_NAV_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    for (const cb of navListeners) cb();
  };
  const toggle = (id: string): void => {
    setHidden(
      hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id],
    );
  };
  return {
    hidden,
    isHidden: (id: string) => hidden.includes(id),
    toggle,
    setHidden,
  };
}

// ---------------------------------------------------------------------------
// Navigation collapsed — when true the desktop sidebar shrinks to an
// icon-only rail. Persisted as "1"/"0"; defaults to expanded.
// ---------------------------------------------------------------------------

const COLLAPSED_KEY = "navCollapsed";
const collapsedListeners = new Set<() => void>();
let collapsedCache: boolean | null = null;

function readCollapsed(): boolean {
  if (collapsedCache != null) return collapsedCache;
  if (typeof window === "undefined") return false;
  try {
    collapsedCache = localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    collapsedCache = false;
  }
  return collapsedCache;
}

function subscribeCollapsed(cb: () => void): () => void {
  collapsedListeners.add(cb);
  return () => {
    collapsedListeners.delete(cb);
  };
}

const getServerCollapsed = (): boolean => false;

export function useNavCollapsed(): {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (next: boolean) => void;
} {
  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    readCollapsed,
    getServerCollapsed,
  );
  const setCollapsed = (next: boolean): void => {
    collapsedCache = next;
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
    for (const cb of collapsedListeners) cb();
  };
  return { collapsed, toggle: () => setCollapsed(!collapsed), setCollapsed };
}

// ---------------------------------------------------------------------------
// Repository filter — which repo ids stay pinned on the Repositories panel.
// Persisted device-locally so the saved selection survives reloads even when
// the server-synced copy (user_preferences.visible_repo_ids) isn't available.
// `null` means "never set on this device" — callers fall back to the
// server-provided value in that case. An empty array is meaningful: it means
// the filter was explicitly cleared ("show all repos").
// ---------------------------------------------------------------------------

const REPO_FILTER_KEY = "visibleRepoIds";

export function readRepoFilter(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(REPO_FILTER_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return null;
  }
}

export function writeRepoFilter(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(REPO_FILTER_KEY, JSON.stringify(ids));
  } catch {
    // ignore — quota or privacy mode; the server sync is the fallback.
  }
}

// ---------------------------------------------------------------------------
// Costs panel filters — device-local settings for the App-costs & scaling
// section, kept separate from the shared Repositories filter above. Two knobs:
// a boolean "only show repos that have the stack-and-scaling.md file", and an
// explicit hide-list of repo ids the user doesn't want shown there.
// ---------------------------------------------------------------------------

const COSTS_ONLY_WITH_FILE_KEY = "costsOnlyWithFile";
const COSTS_HIDDEN_REPOS_KEY = "costsHiddenRepoIds";

export function readCostsOnlyWithFile(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(COSTS_ONLY_WITH_FILE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeCostsOnlyWithFile(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(COSTS_ONLY_WITH_FILE_KEY, value ? "1" : "0");
  } catch {
    // ignore — quota or privacy mode.
  }
}

export function readCostsHiddenRepos(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(COSTS_HIDDEN_REPOS_KEY);
    if (raw == null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

export function writeCostsHiddenRepos(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(COSTS_HIDDEN_REPOS_KEY, JSON.stringify(ids));
  } catch {
    // ignore — quota or privacy mode.
  }
}
