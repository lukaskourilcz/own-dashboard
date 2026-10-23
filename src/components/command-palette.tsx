"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Languages, LogOut, Moon, Search, Settings, Sun } from "lucide-react";
import { PRIMARY_NAV_ITEMS, NAV_GROUPS } from "@/components/nav/sidebar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useNavVisibility } from "@/lib/use-prefs";
import { useTheme } from "@/lib/use-theme";
import { useDict, useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { NavTab } from "@/components/nav/sidebar";

type Group = "go" | "act";

type Action = {
  id: string;
  label: string;
  hint?: string;
  group: Group;
  icon: typeof Search;
  keywords?: string;
  run: () => void;
};

export function CommandPalette({
  setTab,
}: {
  setTab: (t: NavTab) => void;
}) {
  const { theme, toggle } = useTheme();
  const { lang, setLang } = useLang();
  const t = useDict();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const { hidden } = useNavVisibility();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!open) { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setQuery(""); setActive(0); }
        setOpen(!open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const actions: Action[] = useMemo(() => {
    const close = () => setOpen(false);
    const go = (tab: NavTab) => () => {
      setTab(tab);
      close();
    };
    const s = t.nav.sections;
    const list: Action[] = [
      ...[...PRIMARY_NAV_ITEMS, ...NAV_GROUPS.flatMap(group => group.items), { value: 'settings' as const, icon: Settings }]
        .filter(item => !hidden.includes(item.value))
        .map(item => ({ id: `go-${item.value}`, label: s[item.value], group: 'go' as const, icon: item.icon,
          keywords: `${item.value} ${item.value === 'tasks' ? 'todo g t' : item.value === 'notes' ? 'writing drafts g n' : item.value === 'opportunities' ? 'pipeline leads tugedr' : item.value === 'home' ? 'dashboard g h' : ''}`, run: go(item.value) })),
      {
        id: "act-theme",
        label: theme === "dark" ? t.app.switchToLight : t.app.switchToDark,
        group: "act",
        icon: theme === "dark" ? Sun : Moon,
        keywords: "dark light theme appearance motiv vzhled",
        run: () => {
          toggle();
          close();
        },
      },
      {
        id: "act-lang",
        label: lang === "cs" ? t.app.switchToEnglish : t.app.switchToCzech,
        group: "act",
        icon: Languages,
        keywords: "language jazyk čeština english angličtina",
        run: () => {
          setLang(lang === "cs" ? "en" : "cs");
          close();
        },
      },
      {
        id: "act-signout",
        label: t.nav.signOut,
        group: "act",
        icon: LogOut,
        keywords: "logout odhlásit",
        run: () => {
          const form = document.createElement("form");
          form.method = "POST";
          form.action = "/auth/signout";
          document.body.appendChild(form);
          form.submit();
        },
      },
    ];
    return list;
  }, [setTab, theme, toggle, lang, setLang, t, hidden]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) =>
      (a.label + " " + (a.keywords ?? "")).toLowerCase().includes(q),
    );
  }, [actions, query]);

  // Clamp active to the current filtered length at render time — avoids the
  // set-state-in-effect anti-pattern when the filter shrinks.
  const safeActive = Math.min(active, Math.max(0, filtered.length - 1));

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(filtered.length - 1, safeActive + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(0, safeActive - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[safeActive];
      if (item) item.run();
    }
  }

  // Group rendering: stable group order, only show non-empty groups.
  const grouped = useMemo(() => {
    const groups: Record<Group, Action[]> = { go: [], act: [] };
    for (const a of filtered) groups[a.group].push(a);
    return groups;
  }, [filtered]);

  const groupLabels: Record<Group, string> = {
    go: t.app.groupGoTo,
    act: t.app.groupActions,
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="!top-[12dvh] !translate-y-0 max-w-lg overflow-hidden p-0" showClose={false} aria-describedby={undefined}
        onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus(); }}
        onCloseAutoFocus={(event) => { event.preventDefault(); if (opener.current?.isConnected) opener.current.focus(); }}>
        <DialogTitle className="sr-only">{t.app.commandPalette}</DialogTitle>
            <div className="flex items-center gap-2 px-3.5 border-b border-border">
              <Search className="h-4 w-4 text-foreground-subtle" />
              <input
                aria-label={t.app.searchPlaceholder}
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKey}
                placeholder={t.app.searchPlaceholder}
                className="flex-1 h-11 bg-transparent text-sm outline-none placeholder:text-foreground-subtle"
              />
              <kbd className="text-[10px] text-foreground-subtle font-medium border border-border rounded px-1.5 py-0.5">
                esc
              </kbd>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-1.5">
              {filtered.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-foreground-subtle">
                  {t.app.noMatches}
                </p>
              ) : (
                (Object.keys(grouped) as Group[]).map((groupName) =>
                  grouped[groupName].length === 0 ? null : (
                    <div key={groupName} className="mb-1">
                      <p className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider text-foreground-subtle">
                        {groupLabels[groupName]}
                      </p>
                      <ul>
                        {grouped[groupName].map((it) => {
                          const idx = filtered.indexOf(it);
                          const isActive = idx === safeActive;
                          return (
                            <li key={it.id}>
                              <button
                                type="button"
                                onMouseEnter={() => setActive(idx)}
                                onClick={() => it.run()}
                                className={cn(
                                  "min-h-11 w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-left transition-colors focus-ring md:min-h-8",
                                  isActive
                                    ? "bg-accent text-foreground"
                                    : "text-foreground-muted hover:text-foreground",
                                )}
                              >
                                <it.icon className="h-3.5 w-3.5 shrink-0" />
                                <span className="flex-1">{it.label}</span>
                                {it.hint && (
                                  <kbd className="text-[10px] text-foreground-subtle font-medium border border-border rounded px-1 py-0.5">
                                    {it.hint}
                                  </kbd>
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ),
                )
              )}
            </div>
      </DialogContent>
    </Dialog>
  );
}
