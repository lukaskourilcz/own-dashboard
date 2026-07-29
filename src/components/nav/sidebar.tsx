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
import { saveUserPreferences } from "@/lib/preference-client";
import type { NavTab } from "@/lib/nav-tabs";
import type { Project } from "@/lib/types";

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
  projects = [],
  unreadNotifications = 0,
  syncPreferences = true,
  onOpenProject,
}: {
  tab: NavTab;
  setTab: (t: NavTab) => void;
  user: { name: string | null; email: string; avatar_url?: string | null };
  projects?: Pick<Project, "id" | "name" | "slug" | "is_active">[];
  unreadNotifications?: number;
  syncPreferences?: boolean;
  onOpenProject?: (project: Pick<Project, "id" | "name" | "slug" | "is_active">) => void;
}) {
  const t = useDict();
  const { isHidden } = useNavVisibility();
  const { order } = useNavOrder();
  const { collapsed, toggle: toggleCollapsed } = useNavCollapsed();
  const toggleCollapsedAndSync = () => {
    const next = !collapsed;
    toggleCollapsed();
    if (!syncPreferences) return;
    void saveUserPreferences({ navigation_collapsed: next }).catch(
      () => undefined,
    );
  };
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
            : "w-full gap-2 px-[9px] py-[5px]",
          active
            ? "font-medium text-[var(--sidebar-foreground)]"
            : "text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-hover)]",
        )}
      >
        {active && (
          <motion.span
            layoutId="active-nav"
            className="absolute inset-0 rounded-md bg-[var(--sidebar-selected)]"
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
        "mac-sidebar hidden md:absolute md:inset-y-0 md:left-0 md:z-30 md:flex md:flex-col md:border-r",
        "transition-[width] duration-200 ease-out",
        collapsed ? "md:w-[var(--rail-width)]" : "md:w-[var(--sidebar-width)]",
      )}
    >
      {/* macOS window chrome and rail control */}
      <div
        className={cn(
          "flex h-[var(--toolbar-height)] items-center",
          collapsed ? "justify-center px-2" : "gap-2.5 px-4",
        )}
      >
        {collapsed ? (
          <Tooltip content={t.nav.expand} side="right">
            <button
              type="button"
              onClick={toggleCollapsedAndSync}
              aria-label={t.nav.expand}
              aria-expanded={false}
              className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--sidebar-muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-foreground)] focus-ring"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </Tooltip>
        ) : (
          <>
            <span className="traffic-light h-3 w-3 rounded-full bg-[var(--traffic-close)]" aria-hidden />
            <span className="traffic-light h-3 w-3 rounded-full bg-[var(--traffic-minimize)]" aria-hidden />
            <span className="traffic-light h-3 w-3 rounded-full bg-[var(--traffic-zoom)]" aria-hidden />
            <Tooltip content={t.nav.collapse} side="right">
              <button
                type="button"
                onClick={toggleCollapsedAndSync}
                aria-label={t.nav.collapse}
                aria-expanded={true}
                className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--sidebar-muted)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-foreground)] focus-ring"
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
          "flex-1 overflow-y-auto pb-2 pt-1",
          collapsed ? "px-1.5 space-y-0.5" : "px-2.5 space-y-px",
        )}
      >
        {PRIMARY_NAV_ITEMS.filter(isVisible).map(renderItem)}

        {groups.map((g) => (
          <div key={g.id} className={cn(!collapsed && "pt-2")}>
            {collapsed ? (
              <div className="mx-auto my-1.5 h-px w-6 bg-[var(--sidebar-border)]" aria-hidden />
            ) : (
              <p className="px-[9px] pb-[3px] text-[11px] font-semibold text-[var(--sidebar-muted)]">
                {t.nav.groups[g.id]}
              </p>
            )}
            <div className="space-y-0.5">
              {g.items.map((item) => (
                <div key={item.value}>
                  {renderItem(item)}
                  {!collapsed &&
                    item.value === "projects" &&
                    projects.length > 0 && (
                      <ul className="ml-7 mt-1 space-y-px border-l border-[var(--sidebar-border)] pl-2">
                        {projects.map((project) => (
                          <li key={project.id}>
                            <a
                              href={`/projects/${encodeURIComponent(project.slug)}`}
                              onClick={(event) => {
                                if (!onOpenProject) return;
                                event.preventDefault();
                                onOpenProject(project);
                              }}
                              className="block truncate rounded px-2 py-1 text-[11px] text-[var(--sidebar-muted)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-foreground)] focus-ring"
                              title={project.name}
                            >
                              {project.name}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* user footer — identity on top, actions below */}
      <div className="space-y-1.5 border-t border-[var(--sidebar-border)] p-2.5">
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
              className="h-7 w-7 rounded-full bg-white/10 object-cover"
            />
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-[11px] font-medium text-[var(--sidebar-foreground)]">
              {initials}
            </div>
          )}
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">
                {user.name ?? user.email.split("@")[0]}
              </p>
              <p className="truncate text-[11px] text-[var(--sidebar-muted)]">
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
              className="relative inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--sidebar-muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-foreground)] focus-ring"
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
                  ? "bg-[var(--sidebar-selected)] text-[var(--sidebar-foreground)]"
                  : "text-[var(--sidebar-muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-foreground)]",
              )}
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip content={t.nav.theme} side={collapsed ? "right" : "top"}>
            <span><ThemeToggle syncPreferences={syncPreferences} /></span>
          </Tooltip>
          <Tooltip content={t.nav.signOut} side={collapsed ? "right" : "top"}>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                aria-label={t.nav.signOut}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--sidebar-muted)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-foreground)] focus-ring"
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
