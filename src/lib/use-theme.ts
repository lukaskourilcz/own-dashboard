"use client";

import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const listeners = new Set<() => void>();

function readTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const getSnapshot = (): Theme => readTheme();
const getServerSnapshot = (): Theme => "light";

export function useTheme(): { theme: Theme; setTheme: (next: Theme) => void; toggle: () => void } {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setTheme = (next: Theme): void => {
    if (typeof document === "undefined") return;
    if (next === "dark") document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
    try {
      localStorage.setItem("theme", next);
    } catch {
      // localStorage may be blocked — degrade silently.
    }
    for (const cb of listeners) cb();
  };
  const toggle = (): void => setTheme(theme === "dark" ? "light" : "dark");
  return { theme, setTheme, toggle };
}
