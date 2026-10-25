"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/use-theme";
import { useSaveUserPreferences } from "@/lib/preference-client";
import { useDict } from "@/lib/i18n";

export function ThemeToggle({
  syncPreferences = true,
}: {
  syncPreferences?: boolean;
}) {
  const saveUserPreferences = useSaveUserPreferences();
  const { theme, setTheme } = useTheme();
  const t = useDict();
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
      aria-label={theme === "dark" ? t.settings.switchToLight : t.settings.switchToDark}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--sidebar-muted,var(--foreground-muted))] transition-colors hover:bg-[var(--sidebar-hover,var(--surface-hover))] hover:text-[var(--sidebar-foreground,var(--foreground))] focus-ring md:h-7 md:w-7"
    >
      {theme === "dark" ? (
        <Sun className="h-3.5 w-3.5" />
      ) : (
        <Moon className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
