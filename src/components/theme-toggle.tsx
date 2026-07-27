"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/use-theme";
import { saveUserPreferences } from "@/lib/preference-client";

export function ThemeToggle({
  syncPreferences = true,
}: {
  syncPreferences?: boolean;
}) {
  const { theme, setTheme } = useTheme();
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (!syncPreferences) return;
    void saveUserPreferences({ theme: next }).catch(() => undefined);
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--sidebar-muted,var(--foreground-muted))] transition-colors hover:bg-[var(--sidebar-hover,var(--surface-hover))] hover:text-[var(--sidebar-foreground,var(--foreground))] focus-ring"
    >
      {theme === "dark" ? (
        <Sun className="h-3.5 w-3.5" />
      ) : (
        <Moon className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
