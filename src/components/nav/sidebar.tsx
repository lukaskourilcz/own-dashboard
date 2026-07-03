"use client";

import { motion } from "motion/react";
import {
  Activity,
  BookOpen,
  CalendarDays,
  CreditCard,
  FileText,
  Flame,
  Gauge,
  Gift,
  Heart,
  LayoutDashboard,
  ListTodo,
  LogOut,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Settings,
  Sparkles,
  Target,
  Terminal,
  Users,
  Wallet,
} from "lucide-react";
import { GithubIcon } from "@/components/icons/github";
import { ThemeToggle } from "@/components/theme-toggle";
import { Tooltip } from "@/components/ui/tooltip";
import { useDict } from "@/lib/i18n";
import { useFeatureFlag, FLAGS } from "@/lib/feature-flags";
import { useNavCollapsed, useNavVisibility } from "@/lib/use-prefs";
import { cn } from "@/lib/utils";
import type { NavTab } from "@/lib/nav-tabs";

export type { NavTab };

type NavItem = {
  value: Exclude<NavTab, "settings">;
  icon: typeof Activity;
};

// Single source of truth for the main nav sections (order matters). "overview"
// is always shown; the rest can be hidden via Settings. "settings" lives
// outside this list — it has its own always-visible affordance.
export const NAV_ITEMS: NavItem[] = [
  { value: "overview", icon: LayoutDashboard },
  { value: "calendar", icon: CalendarDays },
  { value: "notes", icon: FileText },
  { value: "prompts", icon: MessageSquareText },
  { value: "shortcuts", icon: Terminal },
  { value: "todos", icon: ListTodo },
  { value: "tugedr", icon: Users },
  { value: "streaks", icon: Flame },
  { value: "finances", icon: Wallet },
  { value: "invoices", icon: Receipt },
  { value: "subscriptions", icon: CreditCard },
  { value: "plans", icon: Target },
  { value: "books", icon: BookOpen },
  { value: "dates", icon: Gift },
  { value: "couple", icon: Heart },
  { value: "github", icon: GithubIcon },
  { value: "costs", icon: Gauge },
  { value: "ai", icon: Sparkles },
];

export function Sidebar({
  tab,
  setTab,
  user,
  incomingInvites,
}: {
  tab: NavTab;
  setTab: (t: NavTab) => void;
  user: { name: string | null; email: string; avatar_url?: string | null };
  incomingInvites: number;
}) {
  const t = useDict();
  const { isHidden } = useNavVisibility();
  const { collapsed, toggle: toggleCollapsed } = useNavCollapsed();
  const tugedrEnabled = useFeatureFlag(FLAGS.tugedr);

  const items = NAV_ITEMS.filter(
    (it) =>
      (it.value === "overview" || !isHidden(it.value)) &&
      (it.value !== "tugedr" || tugedrEnabled),
  );

  const initials = (user.name?.trim() || user.email).slice(0, 2).toUpperCase();

  return (
    <aside
      className={cn(
        "hidden md:flex md:flex-col md:border-r md:border-border md:bg-surface md:fixed md:inset-y-0 md:left-0 md:z-30",
        "transition-[width] duration-200 ease-out",
        collapsed ? "md:w-16" : "md:w-60",
      )}
    >
      {/* brand */}
      <div
        className={cn(
          "flex h-14 items-center border-b border-border",
          collapsed ? "justify-center px-2" : "gap-2.5 px-4",
        )}
      >
        {collapsed ? (
          // Collapsed: the logo doubles as the expand control, swapping to a
          // panel icon on hover so it reads as interactive.
          <Tooltip content={t.nav.expand} side="right">
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={t.nav.expand}
              aria-expanded={false}
              className="group relative h-7 w-7 shrink-0 rounded-md bg-primary text-primary-foreground flex items-center justify-center focus-ring"
            >
              <Activity className="h-3.5 w-3.5 transition-opacity group-hover:opacity-0" />
              <PanelLeftOpen className="absolute h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          </Tooltip>
        ) : (
          <>
            <div className="h-7 w-7 shrink-0 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
              <Activity className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-semibold tracking-tight">
              {t.nav.brand}
            </span>
            <Tooltip content={t.nav.collapse} side="right">
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label={t.nav.collapse}
                aria-expanded={true}
                className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted hover:text-foreground hover:bg-surface-hover transition-colors focus-ring"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </Tooltip>
          </>
        )}
      </div>

      {/* nav */}
      <nav className={cn("flex-1 overflow-y-auto p-2 space-y-0.5", collapsed && "px-1.5")}>
        {items.map((it) => {
          const active = tab === it.value;
          const badge = it.value === "couple" ? incomingInvites : 0;
          const label = t.nav.sections[it.value];
          const button = (
            <button
              key={it.value}
              type="button"
              onClick={() => setTab(it.value)}
              aria-label={collapsed ? label : undefined}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center rounded-md text-sm transition-colors duration-150 focus-ring",
                collapsed
                  ? "mx-auto h-9 w-9 justify-center"
                  : "w-full gap-2.5 px-2.5 py-1.5",
                active
                  ? "text-foreground"
                  : "text-foreground-muted hover:text-foreground hover:bg-surface-hover",
              )}
            >
              {active && (
                <motion.span
                  layoutId="active-nav"
                  className="absolute inset-0 rounded-md bg-accent"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <it.icon className="relative z-10 h-4 w-4 shrink-0" />
              {!collapsed && (
                <span className="relative z-10 flex-1 text-left font-medium">
                  {label}
                </span>
              )}
              {badge ? (
                collapsed ? (
                  <span className="absolute right-1 top-1 z-10 h-2 w-2 rounded-full bg-foreground ring-2 ring-surface" />
                ) : (
                  <span className="relative z-10 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-medium text-background tabular">
                    {badge}
                  </span>
                )
              ) : null}
            </button>
          );
          return collapsed ? (
            <Tooltip key={it.value} content={label} side="right">
              {button}
            </Tooltip>
          ) : (
            button
          );
        })}
      </nav>

      {/* user footer — identity on top, actions below */}
      <div className="border-t border-border p-2 space-y-1.5">
        <div
          className={cn(
            "flex items-center py-1",
            collapsed ? "justify-center" : "gap-2 px-1",
          )}
        >
          {user.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatar_url}
              alt=""
              referrerPolicy="no-referrer"
              className="h-7 w-7 rounded-full object-cover bg-surface-muted"
            />
          ) : (
            <div className="h-7 w-7 rounded-full bg-surface-muted text-foreground-muted flex items-center justify-center text-[11px] font-medium">
              {initials}
            </div>
          )}
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">
                {user.name ?? user.email.split("@")[0]}
              </p>
              <p className="text-[11px] text-foreground-subtle truncate">
                {user.email}
              </p>
            </div>
          )}
        </div>

        <div
          className={cn(
            "flex items-center gap-1",
            collapsed ? "flex-col" : "px-0.5",
          )}
        >
          <Tooltip content={t.nav.settings} side={collapsed ? "right" : "top"}>
            <button
              type="button"
              onClick={() => setTab("settings")}
              aria-label={t.nav.settings}
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-ring",
                tab === "settings"
                  ? "text-foreground bg-accent"
                  : "text-foreground-muted hover:text-foreground hover:bg-surface-hover",
              )}
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip content={t.nav.theme} side={collapsed ? "right" : "top"}>
            <span><ThemeToggle /></span>
          </Tooltip>
          <Tooltip content={t.nav.signOut} side={collapsed ? "right" : "top"}>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                aria-label={t.nav.signOut}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted hover:text-foreground hover:bg-surface-hover transition-colors focus-ring"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </form>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}

/* Mobile bottom-bar nav (md:hidden) — same items, condensed */
export function MobileNav({
  tab,
  setTab,
  incomingInvites,
}: {
  tab: NavTab;
  setTab: (t: NavTab) => void;
  incomingInvites: number;
}) {
  const t = useDict();
  const { isHidden } = useNavVisibility();
  const tugedrEnabled = useFeatureFlag(FLAGS.tugedr);
  const items = NAV_ITEMS.filter(
    (it) =>
      (it.value === "overview" || !isHidden(it.value)) &&
      (it.value !== "tugedr" || tugedrEnabled),
  );

  return (
    <div
      data-testid="mobile-nav"
      className="md:hidden sticky top-0 z-30 -mx-4 px-4 py-2 bg-surface/80 backdrop-blur border-b border-border"
    >
      <div className="flex gap-1 overflow-x-auto">
        {items.map((it) => {
          const active = tab === it.value;
          const badge = it.value === "couple" ? incomingInvites : 0;
          return (
            <button
              key={it.value}
              type="button"
              onClick={() => setTab(it.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
                active
                  ? "bg-accent text-foreground"
                  : "text-foreground-muted hover:text-foreground",
              )}
            >
              <it.icon className="h-3.5 w-3.5" />
              {t.nav.short[it.value] ?? t.nav.sections[it.value]}
              {badge ? (
                <span className="inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-foreground px-1 text-[9px] text-background tabular">
                  {badge}
                </span>
              ) : null}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setTab("settings")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
            tab === "settings"
              ? "bg-accent text-foreground"
              : "text-foreground-muted hover:text-foreground",
          )}
        >
          <Settings className="h-3.5 w-3.5" />
          {t.nav.sections.settings}
        </button>
      </div>
    </div>
  );
}
