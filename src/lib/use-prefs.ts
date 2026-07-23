"use client";

import { useSyncExternalStore } from "react";
import {
  LEGACY_ROUTE_ALIASES,
  NAV_TABS,
  type NavTab,
} from "@/lib/nav-tabs";
import {
  normalizeHiddenProjectTabs,
  type ProjectWorkspaceTab,
} from "@/lib/project-workspace-tabs";

/**
 * Lightweight client cache for UI preferences, following the same
 * localStorage + useSyncExternalStore pattern as `useTheme`. Settings-facing
 * values are hydrated from and written to the own-only user_preferences row;
 * localStorage prevents a flash and keeps preview/offline UI usable.
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

const PREFERENCE_NAV_IDS = new Set<string>(
  NAV_TABS.filter((id) => id !== "home" && id !== "inbox" && id !== "settings"),
);

/** Map meaningful legacy ids and discard removed/unknown sections. */
export function normalizeNavPreferenceIds(input: unknown): NavTab[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<NavTab>();
  const normalized: NavTab[] = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    const mapped = (
      item in LEGACY_ROUTE_ALIASES
        ? LEGACY_ROUTE_ALIASES[item as keyof typeof LEGACY_ROUTE_ALIASES]
        : item
    ) as NavTab;
    if (!PREFERENCE_NAV_IDS.has(mapped) || seen.has(mapped)) continue;
    seen.add(mapped);
    normalized.push(mapped);
  }
  return normalized;
}

function readHidden(): readonly string[] {
  if (hiddenCache != null) return hiddenCache;
  if (typeof window === "undefined") return EMPTY_HIDDEN;
  try {
    const raw = localStorage.getItem(HIDDEN_NAV_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    hiddenCache = normalizeNavPreferenceIds(parsed);
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
  reset: () => void;
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
    reset: () => setHidden([]),
  };
}

// ---------------------------------------------------------------------------
// Navigation order — a custom order for the nav sections, chosen by dragging in
// Settings. Stored as an ordered list of section ids; empty means "use the
// built-in order". Sections not present fall back to their default position.
// ---------------------------------------------------------------------------

const NAV_ORDER_KEY = "navOrder";
const navOrderListeners = new Set<() => void>();
const EMPTY_ORDER: readonly string[] = Object.freeze([]);
let navOrderCache: readonly string[] | null = null;

function readNavOrder(): readonly string[] {
  if (navOrderCache != null) return navOrderCache;
  if (typeof window === "undefined") return EMPTY_ORDER;
  try {
    const raw = localStorage.getItem(NAV_ORDER_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    navOrderCache = normalizeNavPreferenceIds(parsed);
  } catch {
    navOrderCache = EMPTY_ORDER;
  }
  return navOrderCache;
}

function subscribeNavOrder(cb: () => void): () => void {
  navOrderListeners.add(cb);
  return () => {
    navOrderListeners.delete(cb);
  };
}

const getServerNavOrder = (): readonly string[] => EMPTY_ORDER;

export function useNavOrder(): {
  order: readonly string[];
  setOrder: (next: string[]) => void;
  reset: () => void;
} {
  const order = useSyncExternalStore(
    subscribeNavOrder,
    readNavOrder,
    getServerNavOrder,
  );
  const setOrder = (next: string[]): void => {
    navOrderCache = Object.freeze([...next]);
    try {
      localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(next));
    } catch {
      // ignore — quota or privacy mode.
    }
    for (const cb of navOrderListeners) cb();
  };
  return { order, setOrder, reset: () => setOrder([]) };
}

/**
 * Stable-sort items by a saved custom nav order. Items whose `value` appears in
 * `order` come first, in that order; anything not listed keeps its original
 * relative position after them (Array.sort is stable). An empty order is a
 * no-op, so callers keep the built-in ordering until the user customizes it.
 */
export function sortByNavOrder<T extends { value: string }>(
  items: T[],
  order: readonly string[],
): T[] {
  if (order.length === 0) return items;
  const idx = new Map(order.map((v, i) => [v, i]));
  return [...items].sort(
    (a, b) => (idx.get(a.value) ?? Infinity) - (idx.get(b.value) ?? Infinity),
  );
}

// ---------------------------------------------------------------------------
// Project workspace visibility — synchronized like navigation visibility.
// ---------------------------------------------------------------------------

const HIDDEN_PROJECT_TABS_KEY = "hiddenProjectTabs";
const projectTabListeners = new Set<() => void>();
const EMPTY_PROJECT_TABS: readonly ProjectWorkspaceTab[] = Object.freeze([]);
let hiddenProjectTabsCache: readonly ProjectWorkspaceTab[] | null = null;

function readHiddenProjectTabs(): readonly ProjectWorkspaceTab[] {
  if (hiddenProjectTabsCache != null) return hiddenProjectTabsCache;
  if (typeof window === "undefined") return EMPTY_PROJECT_TABS;
  try {
    const raw = localStorage.getItem(HIDDEN_PROJECT_TABS_KEY);
    hiddenProjectTabsCache = normalizeHiddenProjectTabs(
      raw ? JSON.parse(raw) : [],
    );
  } catch {
    hiddenProjectTabsCache = EMPTY_PROJECT_TABS;
  }
  return hiddenProjectTabsCache;
}

function subscribeProjectTabs(cb: () => void): () => void {
  projectTabListeners.add(cb);
  return () => projectTabListeners.delete(cb);
}

export function useProjectTabVisibility(): {
  hiddenProjectTabs: readonly ProjectWorkspaceTab[];
  isProjectTabHidden: (tab: ProjectWorkspaceTab) => boolean;
  setHiddenProjectTabs: (tabs: string[]) => void;
} {
  const hiddenProjectTabs = useSyncExternalStore(
    subscribeProjectTabs,
    readHiddenProjectTabs,
    () => EMPTY_PROJECT_TABS,
  );
  const setHiddenProjectTabs = (tabs: string[]) => {
    const normalized = Object.freeze(normalizeHiddenProjectTabs(tabs));
    hiddenProjectTabsCache = normalized;
    try {
      localStorage.setItem(
        HIDDEN_PROJECT_TABS_KEY,
        JSON.stringify(normalized),
      );
    } catch {
      // Local cache is optional; the database remains authoritative.
    }
    for (const cb of projectTabListeners) cb();
  };
  return {
    hiddenProjectTabs,
    isProjectTabHidden: (tab) => hiddenProjectTabs.includes(tab),
    setHiddenProjectTabs,
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
// Tasks per category — how many tasks each Úkoly category card shows before
// the "show all / show less" control. 0 means "show all". Defaults to 5.
// ---------------------------------------------------------------------------

export const DEFAULT_TASKS_PER_CATEGORY = 5;
/** Selectable values in Settings; 0 = show all. */
export const TASKS_PER_CATEGORY_OPTIONS = [3, 5, 10, 0] as const;

const TASKS_PER_CATEGORY_KEY = "tasksPerCategory";
const tasksPerCategoryListeners = new Set<() => void>();
let tasksPerCategoryCache: number | null = null;

function readTasksPerCategory(): number {
  if (tasksPerCategoryCache != null) return tasksPerCategoryCache;
  if (typeof window === "undefined") return DEFAULT_TASKS_PER_CATEGORY;
  try {
    const raw = localStorage.getItem(TASKS_PER_CATEGORY_KEY);
    const n = raw == null ? NaN : Number(raw);
    tasksPerCategoryCache = Number.isFinite(n) && n >= 0 ? n : DEFAULT_TASKS_PER_CATEGORY;
  } catch {
    tasksPerCategoryCache = DEFAULT_TASKS_PER_CATEGORY;
  }
  return tasksPerCategoryCache;
}

function subscribeTasksPerCategory(cb: () => void): () => void {
  tasksPerCategoryListeners.add(cb);
  return () => {
    tasksPerCategoryListeners.delete(cb);
  };
}

const getServerTasksPerCategory = (): number => DEFAULT_TASKS_PER_CATEGORY;

export function useTasksPerCategory(): {
  count: number;
  setCount: (next: number) => void;
} {
  const count = useSyncExternalStore(
    subscribeTasksPerCategory,
    readTasksPerCategory,
    getServerTasksPerCategory,
  );
  const setCount = (next: number): void => {
    tasksPerCategoryCache = next;
    try {
      localStorage.setItem(TASKS_PER_CATEGORY_KEY, String(next));
    } catch {
      // ignore
    }
    for (const cb of tasksPerCategoryListeners) cb();
  };
  return { count, setCount };
}

// ---------------------------------------------------------------------------
// CV links — the user's Google-Docs CV URLs (Czech + English), surfaced as
// buttons on the Career page and edited in Settings. Device-local strings;
// empty = not set (the button is hidden).
// ---------------------------------------------------------------------------

/** A minimal localStorage-backed string preference following the same
 * cache + listener + useSyncExternalStore pattern as the prefs above. */
function makeStringPref(key: string) {
  const listeners = new Set<() => void>();
  let cache: string | null = null;
  return {
    read(): string {
      if (cache != null) return cache;
      if (typeof window === "undefined") return "";
      try {
        cache = localStorage.getItem(key) ?? "";
      } catch {
        cache = "";
      }
      return cache;
    },
    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    set(next: string): void {
      cache = next;
      try {
        localStorage.setItem(key, next);
      } catch {
        // ignore — quota or privacy mode
      }
      for (const cb of listeners) cb();
    },
  };
}

const cvCsPref = makeStringPref("cvUrlCs");
const cvEnPref = makeStringPref("cvUrlEn");
const getServerCv = (): string => "";

export function useCvLinks(): {
  cs: string;
  en: string;
  setCs: (v: string) => void;
  setEn: (v: string) => void;
} {
  const cs = useSyncExternalStore(cvCsPref.subscribe, cvCsPref.read, getServerCv);
  const en = useSyncExternalStore(cvEnPref.subscribe, cvEnPref.read, getServerCv);
  return { cs, en, setCs: cvCsPref.set, setEn: cvEnPref.set };
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

// Collapsed project cards (project ids). Reorder persists to the DB via
// sort_order; collapse is a per-device view preference, so it lives here.
const COLLAPSED_PROJECTS_KEY = "collapsedProjectIds";

export function readCollapsedProjects(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(COLLAPSED_PROJECTS_KEY);
    if (raw == null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

export function writeCollapsedProjects(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(COLLAPSED_PROJECTS_KEY, JSON.stringify(ids));
  } catch {
    // ignore — quota or privacy mode.
  }
}
