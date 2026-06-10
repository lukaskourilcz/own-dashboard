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
