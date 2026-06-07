"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  BookOpen,
  CalendarDays,
  CreditCard,
  Flame,
  Gift,
  Heart,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Target,
  Unlink,
  Wallet,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export type NavTab =
  | "overview"
  | "calendar"
  | "subscriptions"
  | "todos"
  | "streaks"
  | "finances"
  | "plans"
  | "couple"
  | "books"
  | "dates";

type Item = {
  value: NavTab;
  label: string;
  icon: typeof Activity;
  badge?: number;
};

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
  const toast = useToast();
  const [disconnecting, setDisconnecting] = useState(false);

  async function disconnectGoogle() {
    const ok = window.confirm(
      "Disconnect Google? Calendar features will need a re-link.",
    );
    if (!ok) return;
    setDisconnecting(true);
    try {
      const res = await fetch("/api/google/disconnect", { method: "POST" });
      if (res.ok) {
        toast.ok("Google disconnected.");
        // Soft reload so server components re-render with the no-token state.
        window.location.reload();
      } else {
        toast.err("Could not disconnect Google.");
      }
    } catch {
      toast.err("Network error.");
    } finally {
      setDisconnecting(false);
    }
  }
  const items: Item[] = [
    { value: "overview", label: "Overview", icon: LayoutDashboard },
    { value: "calendar", label: "Calendar", icon: CalendarDays },
    { value: "todos", label: "Tasks", icon: ListTodo },
    { value: "streaks", label: "Habits", icon: Flame },
    { value: "finances", label: "Finances", icon: Wallet },
    { value: "subscriptions", label: "Subscriptions", icon: CreditCard },
    { value: "plans", label: "Plans", icon: Target },
    { value: "books", label: "Books", icon: BookOpen },
    { value: "dates", label: "Dates", icon: Gift },
    { value: "couple", label: "Couple", icon: Heart, badge: incomingInvites },
  ];

  const initials = (user.name?.trim() || user.email).slice(0, 2).toUpperCase();

  return (
    <aside className="hidden md:flex md:w-60 md:flex-col md:border-r md:border-border md:bg-surface md:fixed md:inset-y-0 md:left-0 md:z-30">
      {/* brand */}
      <div className="flex h-14 items-center gap-2.5 px-4 border-b border-border">
        <div className="h-7 w-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
          <Activity className="h-3.5 w-3.5" />
        </div>
        <span className="text-sm font-semibold tracking-tight">Dashboard</span>
      </div>

      {/* nav */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {items.map((it) => {
          const active = tab === it.value;
          return (
            <button
              key={it.value}
              type="button"
              onClick={() => setTab(it.value)}
              className={cn(
                "relative w-full flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150",
                "focus-ring",
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
              <span className="relative z-10 flex-1 text-left font-medium">
                {it.label}
              </span>
              {it.badge ? (
                <span className="relative z-10 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-medium text-background tabular">
                  {it.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {/* user footer */}
      <div className="border-t border-border p-2">
        <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
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
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">
              {user.name ?? user.email.split("@")[0]}
            </p>
            <p className="text-[11px] text-foreground-subtle truncate">
              {user.email}
            </p>
          </div>
          <Tooltip content="Theme">
            <span><ThemeToggle /></span>
          </Tooltip>
          <Tooltip content="Disconnect Google">
            <button
              type="button"
              onClick={disconnectGoogle}
              disabled={disconnecting}
              aria-label="Disconnect Google"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted hover:text-foreground hover:bg-surface-hover transition-colors focus-ring disabled:opacity-50"
            >
              <Unlink className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip content="Sign out">
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                aria-label="Sign out"
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
  const items: Item[] = [
    { value: "overview", label: "Overview", icon: LayoutDashboard },
    { value: "calendar", label: "Calendar", icon: CalendarDays },
    { value: "todos", label: "Tasks", icon: ListTodo },
    { value: "streaks", label: "Habits", icon: Flame },
    { value: "finances", label: "Finances", icon: Wallet },
    { value: "subscriptions", label: "Subs", icon: CreditCard },
    { value: "plans", label: "Plans", icon: Target },
    { value: "books", label: "Books", icon: BookOpen },
    { value: "dates", label: "Dates", icon: Gift },
    { value: "couple", label: "Couple", icon: Heart, badge: incomingInvites },
  ];
  return (
    <div className="md:hidden sticky top-0 z-30 -mx-4 px-4 py-2 bg-surface/80 backdrop-blur border-b border-border">
      <div className="flex gap-1 overflow-x-auto">
        {items.map((it) => {
          const active = tab === it.value;
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
              {it.label}
              {it.badge ? (
                <span className="inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-foreground px-1 text-[9px] text-background tabular">
                  {it.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
