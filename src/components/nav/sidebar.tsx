"use client";

import { useState } from "react";
import { motion } from "motion/react";
import {
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  CircleDollarSign,
  CreditCard,
  FolderInput,
  FileText,
  FolderKanban,
  Gift,
  Inbox,
  Landmark,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Menu,
  MessageSquareText,
  Network,
  Bot,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Settings,
  Tags,
  Target,
  Terminal,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { useDict } from "@/lib/i18n";
import {
  useNavCollapsed,
  useNavOrder,
  useNavVisibility,
  sortByNavOrder,
} from "@/lib/use-prefs";
import { cn } from "@/lib/utils";
import type { NavTab } from "@/lib/nav-tabs";

export type { NavTab };

type NavItem = {
  value: Exclude<NavTab, "settings">;
  icon: LucideIcon;
};

type NavGroupId = "work" | "money" | "planning" | "library";
type NavGroup = { id: NavGroupId; items: NavItem[] };

export const HOME_ITEM: NavItem = { value: "home", icon: LayoutDashboard };
export const INBOX_ITEM: NavItem = { value: "inbox", icon: Inbox };
export const PRIMARY_NAV_ITEMS: NavItem[] = [HOME_ITEM, INBOX_ITEM];

// The rest of the sections, bucketed into a handful of intent-based groups so
// the rail reads as a short list of categories instead of a wall of ~19 links.
// Order matters (within a group and across groups). "settings" lives outside
// these groups — it has its own always-visible affordance in the footer.
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "work",
    items: [
      { value: "work", icon: BriefcaseBusiness },
      { value: "projects", icon: FolderKanban },
      { value: "opportunities", icon: FolderInput },
      { value: "clients", icon: Users },
      { value: "agents", icon: Bot },
      { value: "career", icon: Network },
      { value: "invoices", icon: Receipt },
    ],
  },
  {
    id: "money",
    items: [
      { value: "money", icon: Wallet },
      { value: "accounts", icon: Landmark },
      { value: "transactions", icon: CircleDollarSign },
      { value: "subscriptions", icon: CreditCard },
      { value: "categories", icon: Tags },
    ],
  },
  {
    id: "planning",
    items: [
      { value: "tasks", icon: ListTodo },
      { value: "calendar", icon: CalendarDays },
      { value: "goals", icon: Target },
      { value: "dates", icon: Gift },
    ],
  },
  {
    id: "library",
    items: [
      { value: "notes", icon: FileText },
      { value: "prompts", icon: MessageSquareText },
      { value: "links", icon: Network },
      { value: "references", icon: Terminal },
    ],
  },
];

// Flat, ordered list (overview first, then every group in order). Kept as the
// single source of truth for consumers that don't care about grouping — the
// Settings visibility list and the mobile bottom bar.
export const NAV_ITEMS: NavItem[] = [
  ...PRIMARY_NAV_ITEMS,
  ...NAV_GROUPS.flatMap((g) => g.items),
];

export function Sidebar({
  tab,
  setTab,
  user,
  unreadNotifications = 0,
}: {
  tab: NavTab;
  setTab: (t: NavTab) => void;
  user: { name: string | null; email: string; avatar_url?: string | null };
  unreadNotifications?: number;
}) {
  const t = useDict();
  const { isHidden } = useNavVisibility();
  const { order } = useNavOrder();
  const { collapsed, toggle: toggleCollapsed } = useNavCollapsed();
  const isVisible = (it: NavItem) => !isHidden(it.value);

  // Drop empty groups so we never render a lonely heading with no items, and
  // apply the user's custom order within each group.
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: sortByNavOrder(g.items.filter(isVisible), order),
  })).filter((g) => g.items.length > 0);

  const initials = (user.name?.trim() || user.email).slice(0, 2).toUpperCase();

  const renderItem = (it: NavItem) => {
    const active = tab === it.value;
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
      </button>
    );
    return collapsed ? (
      <Tooltip key={it.value} content={label} side="right">
        {button}
      </Tooltip>
    ) : (
      button
    );
  };

  return (
    <aside
      className={cn(
        "hidden md:flex md:flex-col md:border-r md:border-border md:bg-surface md:fixed md:inset-y-0 md:left-0 md:z-30",
        "transition-[width] duration-200 ease-out",
        collapsed ? "md:w-[var(--rail-width)]" : "md:w-[var(--sidebar-width)]",
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
              className="group relative h-8 w-8 shrink-0 rounded-md text-primary-foreground flex items-center justify-center focus-ring"
            >
              <BrandMark className="h-8 w-8 transition-opacity group-hover:opacity-0" />
              <PanelLeftOpen className="absolute h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          </Tooltip>
        ) : (
          <>
            <BrandMark className="h-8 w-8" />
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

      {/* nav — overview pinned on top, the rest bucketed into labelled groups.
          Collapsed, group labels give way to a hairline divider so the icons
          stay legible in the 64px rail. */}
      <nav
        className={cn(
          "flex-1 overflow-y-auto p-2",
          collapsed ? "px-1.5 space-y-0.5" : "space-y-0.5",
        )}
      >
        {PRIMARY_NAV_ITEMS.filter(isVisible).map(renderItem)}

        {groups.map((g) => (
          <div key={g.id} className={cn(!collapsed && "pt-2")}>
            {collapsed ? (
              <div className="my-1.5 mx-auto h-px w-6 bg-border" aria-hidden />
            ) : (
              <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
                {t.nav.groups[g.id]}
              </p>
            )}
            <div className="space-y-0.5">{g.items.map(renderItem)}</div>
          </div>
        ))}
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
          <Tooltip content={t.nav.sections.inbox} side={collapsed ? "right" : "top"}>
            <button
              type="button"
              onClick={() => setTab("inbox")}
              aria-label={t.nav.sections.inbox}
              className="relative inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-hover hover:text-foreground focus-ring"
            >
              <Bell className="h-3.5 w-3.5" />
              {unreadNotifications > 0 && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-destructive" aria-hidden />}
            </button>
          </Tooltip>
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
}: {
  tab: NavTab;
  setTab: (t: NavTab) => void;
}) {
  const t = useDict();
  const [moreOpen, setMoreOpen] = useState(false);
  const { isHidden } = useNavVisibility();
  const { order } = useNavOrder();
  const primaryValues: NavTab[] = ["home", "inbox", "work", "projects"];
  const allItems = [...PRIMARY_NAV_ITEMS, ...NAV_GROUPS.flatMap((g) => sortByNavOrder(g.items, order))];
  const primaryItems = allItems.filter((item) => primaryValues.includes(item.value) && !isHidden(item.value));
  const secondaryGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: sortByNavOrder(group.items.filter((item) => !primaryValues.includes(item.value) && !isHidden(item.value)), order),
  })).filter((group) => group.items.length > 0);

  return (
    <>
      <nav
        data-testid="mobile-nav"
        aria-label={t.nav.mobileNavigation}
        className="safe-area-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface-elevated/95 px-2 pt-1.5 backdrop-blur md:hidden"
      >
        <div className="mx-auto grid max-w-md grid-cols-5 gap-1">
        {primaryItems.map((it) => {
          const active = tab === it.value;
          return (
            <button
              key={it.value}
              type="button"
              onClick={() => setTab(it.value)}
              className={cn(
                "inline-flex min-h-12 flex-col items-center justify-center gap-1 rounded-md px-1 py-1 text-[10px] font-medium transition-colors focus-ring",
                active
                  ? "bg-surface-selected text-accent-foreground"
                  : "text-foreground-muted hover:text-foreground",
              )}
            >
              <it.icon className="h-4 w-4" />
              {t.nav.short[it.value] ?? t.nav.sections[it.value]}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={cn(
            "inline-flex min-h-12 flex-col items-center justify-center gap-1 rounded-md px-1 py-1 text-[10px] font-medium transition-colors focus-ring",
            secondaryGroups.some((group) => group.items.some((item) => item.value === tab)) || tab === "settings"
              ? "bg-surface-selected text-accent-foreground"
              : "text-foreground-muted hover:text-foreground",
          )}
        >
          <Menu className="h-4 w-4" />
          {t.nav.more}
        </button>
      </div>
      </nav>
      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent className="sheet-dialog !bottom-0 !left-0 !right-0 !top-auto !w-full !max-w-none !translate-x-0 !translate-y-0 rounded-b-none rounded-t-xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-5 md:hidden">
          <DialogHeader>
            <DialogTitle>{t.nav.allAreas}</DialogTitle>
            <DialogDescription>{t.nav.allAreasDescription}</DialogDescription>
          </DialogHeader>
          <nav className="max-h-[65vh] overflow-y-auto" aria-label={t.nav.allAreas}>
            {secondaryGroups.map((group) => <div key={group.id} className="border-t border-border py-3 first:border-t-0">
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-foreground-subtle">{t.nav.groups[group.id]}</p>
              <div className="grid grid-cols-2 gap-1">
                {group.items.map((item) => <button key={item.value} type="button" onClick={() => { setTab(item.value); setMoreOpen(false); }} className={cn("flex min-h-11 items-center gap-2 rounded-md px-2 text-left text-sm focus-ring", tab === item.value ? "bg-surface-selected text-accent-foreground" : "text-foreground-muted hover:bg-surface-hover hover:text-foreground")}><item.icon className="h-4 w-4" />{t.nav.sections[item.value]}</button>)}
              </div>
            </div>)}
            <div className="border-t border-border pt-3"><button type="button" onClick={() => { setTab("settings"); setMoreOpen(false); }} className={cn("flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm focus-ring", tab === "settings" ? "bg-surface-selected text-accent-foreground" : "text-foreground-muted hover:bg-surface-hover hover:text-foreground")}><Settings className="h-4 w-4" />{t.nav.sections.settings}</button></div>
          </nav>
        </DialogContent>
      </Dialog>
    </>
  );
}
