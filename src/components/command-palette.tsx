"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  CalendarDays,
  CreditCard,
  FileText,
  Flame,
  Gift,
  Heart,
  LayoutDashboard,
  Languages,
  ListTodo,
  LogOut,
  Moon,
  Receipt,
  Search,
  Settings,
  Sun,
  Target,
  Wallet,
} from "lucide-react";
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
  onFocusQuickAdd,
}: {
  setTab: (t: NavTab) => void;
  onFocusQuickAdd: () => void;
}) {
  const { theme, toggle } = useTheme();
  const { lang, setLang } = useLang();
  const t = useDict();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global cmd/ctrl+K toggle + Escape to close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => {
          if (prev) return false;
          setQuery("");
          setActive(0);
          requestAnimationFrame(() => inputRef.current?.focus());
          return true;
        });
      } else if (e.key === "Escape") {
        setOpen((v) => (v ? false : v));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const actions: Action[] = useMemo(() => {
    const close = () => setOpen(false);
    const go = (tab: NavTab) => () => {
      setTab(tab);
      close();
    };
    const s = t.nav.sections;
    return [
      { id: "go-overview", label: s.overview, group: "go", icon: LayoutDashboard, keywords: "home dashboard přehled g o", run: go("overview") },
      { id: "go-calendar", label: s.calendar, group: "go", icon: CalendarDays, keywords: "events kalendář g c", run: go("calendar") },
      { id: "go-notes", label: s.notes, group: "go", icon: FileText, keywords: "notes prompts writing poznámky g n", run: go("notes") },
      { id: "go-todos", label: s.todos, group: "go", icon: ListTodo, keywords: "todo tasks úkoly g t", run: go("todos") },
      { id: "go-streaks", label: s.streaks, group: "go", icon: Flame, keywords: "streak habit návyky g s", run: go("streaks") },
      { id: "go-finances", label: s.finances, group: "go", icon: Wallet, keywords: "money transactions finance g f", run: go("finances") },
      { id: "go-invoices", label: s.invoices, group: "go", icon: Receipt, keywords: "invoice billing vat dph faktury fakturace g i", run: go("invoices") },
      { id: "go-subs", label: s.subscriptions, group: "go", icon: CreditCard, keywords: "spend recurring předplatná", run: go("subscriptions") },
      { id: "go-plans", label: s.plans, group: "go", icon: Target, keywords: "goals plány g p", run: go("plans") },
      { id: "go-books", label: s.books, group: "go", icon: BookOpen, keywords: "reading knihy g b", run: go("books") },
      { id: "go-dates", label: s.dates, group: "go", icon: Gift, keywords: "anniversary birthday významné dny g d", run: go("dates") },
      { id: "go-couple", label: s.couple, group: "go", icon: Heart, keywords: "partner pair sharing pár g u", run: go("couple") },
      { id: "go-settings", label: s.settings, group: "go", icon: Settings, keywords: "settings preferences nastavení language currency", run: go("settings") },
      {
        id: "act-quick-add",
        label: t.app.openQuickAdd,
        hint: "n",
        group: "act",
        icon: Search,
        keywords: "add new rychlé přidání",
        run: () => {
          setTab("overview");
          close();
          requestAnimationFrame(() => onFocusQuickAdd());
        },
      },
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
  }, [setTab, onFocusQuickAdd, theme, toggle, lang, setLang, t]);

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
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4"
          onClick={() => setOpen(false)}
        >
          <div
            aria-hidden
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />
          <motion.div
            role="dialog"
            aria-label={t.app.commandPalette}
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg rounded-xl border border-border bg-surface shadow-elevated overflow-hidden"
          >
            <div className="flex items-center gap-2 px-3.5 border-b border-border">
              <Search className="h-4 w-4 text-foreground-subtle" />
              <input
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
                                  "w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-left transition-colors",
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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
