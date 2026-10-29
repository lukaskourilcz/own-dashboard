"use client";

import { useSyncExternalStore } from "react";
import { subscribeStoredPreference } from "@/lib/preference-storage";

export type Theme = "light" | "dark";

const listeners = new Set<() => void>();

function readTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function subscribe(cb: () => void): () => void {
  return subscribeStoredPreference("theme", listeners, cb, () => {
    try {
      const value = localStorage.getItem("theme");
      const dark = value === "dark" || (value !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", dark);
    } catch { /* Keep the current in-memory theme when storage is blocked. */ }
  });
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
