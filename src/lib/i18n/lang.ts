"use client";

import { useSyncExternalStore } from "react";

export type Lang = "cs" | "en";

export const LANGS: readonly Lang[] = ["cs", "en"] as const;

// The app ships Czech-first; English is opt-in via Settings.
export const DEFAULT_LANG: Lang = "cs";

const listeners = new Set<() => void>();

// Source of truth on the client is the <html lang> attribute (set by the
// pre-hydration bootstrap in src/app/layout.tsx from localStorage), mirroring
// how useTheme reads the `dark` class. This keeps the first client snapshot in
// sync with whatever the bootstrap painted, with no flash.
function readLang(): Lang {
  if (typeof document === "undefined") return DEFAULT_LANG;
  return document.documentElement.lang === "en" ? "en" : "cs";
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const getSnapshot = (): Lang => readLang();
const getServerSnapshot = (): Lang => DEFAULT_LANG;

export function useLang(): { lang: Lang; setLang: (next: Lang) => void } {
  const lang = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setLang = (next: Lang): void => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = next;
    }
    try {
      localStorage.setItem("lang", next);
    } catch {
      // localStorage may be blocked — degrade silently.
    }
    for (const cb of listeners) cb();
  };
  return { lang, setLang };
}
