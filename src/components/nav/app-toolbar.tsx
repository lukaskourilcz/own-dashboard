"use client";

import { Command, Search } from "lucide-react";
import { useDict } from "@/lib/i18n";
import type { NavTab } from "@/lib/nav-tabs";

export function AppToolbar({
  tab,
  projectName,
  onBack,
}: {
  tab: NavTab;
  projectName?: string;
  /** Inside a project workspace the section title returns to the list; it is the only back control (#171). */
  onBack?: () => void;
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
            {projectName && onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex min-h-11 min-w-11 items-center rounded hover:underline focus-ring md:min-h-8 md:min-w-8"
                data-testid="toolbar-back"
              >
                {title}
              </button>
            ) : (
              title
            )}
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
        className="hidden h-11 min-w-40 max-w-[340px] flex-[0_1_340px] items-center gap-2 rounded-md border border-border-strong bg-surface/90 px-2 text-left text-xs text-foreground-subtle shadow-soft transition-colors hover:bg-surface focus-ring sm:flex md:h-8"
        aria-label={t.app.commandPalette}
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{t.app.searchPlaceholder}</span>
        <kbd className="ml-auto inline-flex h-[18px] items-center gap-0.5 rounded bg-surface-muted px-1.5 text-[10px] font-medium text-foreground-subtle">
          <Command className="h-2.5 w-2.5" />K
        </kbd>
      </button>

    </header>
  );
}
