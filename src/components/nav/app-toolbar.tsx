"use client";

import { Command, Plus, Search } from "lucide-react";
import { useDict } from "@/lib/i18n";
import type { NavTab } from "@/lib/nav-tabs";

export function AppToolbar({
  tab,
  projectName,
  onQuickAdd,
}: {
  tab: NavTab;
  projectName?: string;
  onQuickAdd: () => void;
}) {
  const t = useDict();
  const title = t.nav.sections[tab];

  const openCommandPalette = () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        metaKey: true,
        bubbles: true,
      }),
    );
  };

  return (
    <header className="mac-toolbar relative z-20 flex h-[var(--toolbar-height)] shrink-0 items-center gap-2 px-3 sm:px-5">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="shrink-0 text-[15px] font-semibold tracking-[-0.01em] text-foreground">
            {title}
          </h1>
          {projectName && (
            <>
              <span className="text-foreground-subtle" aria-hidden>
                ›
              </span>
              <span className="truncate text-xs text-foreground-muted">
                {projectName}
              </span>
            </>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={openCommandPalette}
        className="hidden h-7 min-w-40 max-w-[340px] flex-[0_1_340px] items-center gap-2 rounded-md border border-border-strong bg-surface/90 px-2 text-left text-xs text-foreground-subtle shadow-soft transition-colors hover:bg-surface focus-ring sm:flex"
        aria-label={t.app.commandPalette}
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{t.app.searchPlaceholder}</span>
        <kbd className="ml-auto inline-flex h-[18px] items-center gap-0.5 rounded bg-surface-muted px-1.5 text-[10px] font-medium text-foreground-subtle">
          <Command className="h-2.5 w-2.5" />K
        </kbd>
      </button>

      <button
        type="button"
        onClick={onQuickAdd}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 text-xs font-semibold text-foreground shadow-soft transition-colors hover:bg-surface-hover focus-ring"
      >
        <Plus className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t.app.openQuickAdd}</span>
      </button>
    </header>
  );
}
