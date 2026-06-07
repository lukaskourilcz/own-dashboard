"use client";

import { useMemo } from "react";
import { differenceInMinutes, format } from "date-fns";
import {
  CalendarDays,
  ExternalLink,
  Flame,
  ListTodo,
  Moon,
  Sun,
  Sunrise,
} from "lucide-react";
import { SectionLabel } from "@/components/ui/page-header";
import {
  streaksUncheckedToday,
  uncheckedTodayWithCounts,
} from "@/lib/streaks";
import { todayKey } from "@/lib/date-keys";
import { useNow } from "@/lib/use-now";
import { nextUpcoming } from "@/lib/important-dates";
import type { ImportantDate, Streak, StreakLog, Todo } from "@/lib/types";
import {
  eventDateKey,
  eventEnd,
  eventStart,
  eventTimeLabel,
  type EventsResult,
  type GcalEvent,
} from "@/lib/calendar";
import { RelinkGoogleButton } from "@/components/calendar/relink-cta";
import { cn } from "@/lib/utils";

type Props = {
  userName: string | null;
  userEmail: string;
  calendar: EventsResult;
  todos: Todo[];
  streaks: Streak[];
  streakLogs: StreakLog[];
  importantDates: ImportantDate[];
};

function greetingFor(date: Date): { text: string; Icon: typeof Sun } {
  const hour = date.getHours();
  if (hour < 12) return { text: "Good morning", Icon: Sunrise };
  if (hour < 18) return { text: "Good afternoon", Icon: Sun };
  return { text: "Good evening", Icon: Moon };
}

function formatCountdown(minutes: number): string {
  if (minutes < 1) return "now";
  if (minutes < 60) return `in ${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `in ${h}h` : `in ${h}h ${m}m`;
}

export function TodayHero({
  userName,
  userEmail,
  calendar,
  todos,
  streaks,
  streakLogs,
  importantDates,
}: Props) {
  const now = useNow();
  const display = now ?? new Date(0);
  const greeting = now ? greetingFor(now) : null;
  const firstName = (userName?.trim() || userEmail).split(/[\s@]/)[0];
  const today = todayKey();

  const todayEvents = useMemo(() => {
    if (!calendar.ok) return [];
    return calendar.events
      .filter((ev) => eventDateKey(ev) === today)
      .sort((a, b) => {
        const sa = eventStart(a)?.getTime() ?? 0;
        const sb = eventStart(b)?.getTime() ?? 0;
        return sa - sb;
      });
  }, [calendar, today]);

  const { ongoing, nextUp } = useMemo(() => {
    if (!now) return { ongoing: null, nextUp: null };
    let ongoing: GcalEvent | null = null;
    let nextUp: { ev: GcalEvent; minutes: number } | null = null;
    for (const ev of todayEvents) {
      const start = eventStart(ev);
      const end = eventEnd(ev);
      if (!start || !end) continue;
      if (start <= now && now < end) {
        ongoing = ev;
      } else if (start > now) {
        const minutes = differenceInMinutes(start, now);
        if (!nextUp || minutes < nextUp.minutes) nextUp = { ev, minutes };
      }
    }
    return { ongoing, nextUp };
  }, [todayEvents, now]);

  const dueToday = useMemo(
    () => todos.filter((t) => !t.done && t.due_date && t.due_date <= today),
    [todos, today],
  );

  const atRisk = useMemo(
    () => uncheckedTodayWithCounts(streaks, streakLogs).filter((x) => x.count > 0),
    [streaks, streakLogs],
  );

  const otherUnchecked = useMemo(() => {
    const atRiskIds = new Set(atRisk.map((x) => x.streak.id));
    return streaksUncheckedToday(streaks, streakLogs).filter(
      (s) => !atRiskIds.has(s.id),
    );
  }, [streaks, streakLogs, atRisk]);

  const upcoming = useMemo(
    () => (now ? nextUpcoming(importantDates, now) : null),
    [importantDates, now],
  );

  return (
    <section
      className="rounded-xl border border-border bg-surface p-6 md:p-8 shadow-soft"
      suppressHydrationWarning
    >
      {/* greeting row */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground">
            {greeting ? greeting.text : "Welcome"}, {firstName}
          </h1>
          <p className="mt-1 text-sm text-foreground-muted tabular">
            {now ? format(display, "EEEE, MMMM d · HH:mm") : "Loading…"}
          </p>
        </div>

        {/* "now" pill */}
        {ongoing ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-muted px-3 py-1.5 text-xs">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-60 animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
            </span>
            <span className="text-foreground-muted">Now</span>
            <span className="font-medium text-foreground truncate max-w-[180px]">
              {ongoing.summary ?? "(no title)"}
            </span>
          </div>
        ) : nextUp ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-muted px-3 py-1.5 text-xs">
            <span className="text-foreground-muted">Next</span>
            <span className="font-medium text-foreground truncate max-w-[180px]">
              {nextUp.ev.summary ?? "(no title)"}
            </span>
            <span className="text-foreground-subtle tabular">
              {formatCountdown(nextUp.minutes)}
            </span>
          </div>
        ) : null}
      </div>

      {/* upcoming important date */}
      {upcoming && upcoming.daysUntil <= 60 && (
        <p className="mt-4 inline-flex items-center gap-2 text-xs text-foreground-muted">
          <span className="text-base leading-none">
            {upcoming.date.emoji ?? "📌"}
          </span>
          <span className="font-medium text-foreground">
            {upcoming.date.title}
          </span>
          <span className="tabular">
            {upcoming.daysUntil === 0
              ? "is today"
              : upcoming.daysUntil === 1
                ? "tomorrow"
                : `in ${upcoming.daysUntil} days`}
            {upcoming.yearsCompleted !== null &&
            upcoming.yearsCompleted > 0
              ? ` · year ${upcoming.yearsCompleted + 1}`
              : ""}
          </span>
        </p>
      )}

      {/* three columns */}
      <div className="mt-6 grid gap-6 md:grid-cols-3">
        <Column
          icon={CalendarDays}
          label="Today's events"
          empty={
            !calendar.ok
              ? calendar.reason === "unauthorized"
                ? "Calendar token expired."
                : calendar.reason === "no-token"
                  ? "Grant Calendar access."
                  : "Couldn't load events."
              : "Nothing scheduled."
          }
          relink={
            !calendar.ok &&
            (calendar.reason === "unauthorized" ||
              calendar.reason === "no-token") ? (
              <RelinkGoogleButton
                reason={
                  calendar.reason === "unauthorized"
                    ? "expired"
                    : "calendar-access"
                }
              />
            ) : null
          }
          isEmpty={calendar.ok && todayEvents.length === 0}
          isError={!calendar.ok}
        >
          {calendar.ok && (
            <ul className="space-y-1.5">
              {todayEvents.slice(0, 4).map((ev) => {
                const isOngoing = ongoing?.id === ev.id;
                return (
                  <li key={ev.id} className="flex items-start gap-2 text-sm">
                    <span
                      className={cn(
                        "tabular text-xs w-12 shrink-0 pt-0.5",
                        isOngoing ? "text-success font-medium" : "text-foreground-subtle",
                      )}
                    >
                      {eventTimeLabel(ev)}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span
                        className={cn(
                          "block truncate",
                          isOngoing && "font-medium text-foreground",
                        )}
                      >
                        {ev.summary ?? "(no title)"}
                      </span>
                      {ev.description && (
                        <span className="block truncate text-[10px] text-foreground-subtle">
                          {ev.description.replace(/<[^>]*>/g, "").slice(0, 80)}
                        </span>
                      )}
                    </span>
                    {ev.htmlLink && (
                      <a
                        href={ev.htmlLink}
                        target="_blank"
                        rel="noreferrer"
                        className="text-foreground-subtle hover:text-foreground transition-colors"
                        aria-label="Open in Google Calendar"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Column>

        <Column
          icon={ListTodo}
          label="Due today"
          empty="Nothing due."
          isEmpty={dueToday.length === 0}
        >
          <ul className="space-y-1.5">
            {dueToday.slice(0, 4).map((t) => (
              <li key={t.id} className="flex items-start gap-2 text-sm">
                <span
                  className={cn(
                    "tabular text-xs w-12 shrink-0 pt-0.5",
                    t.due_date && t.due_date < today
                      ? "text-destructive font-medium"
                      : "text-foreground-subtle",
                  )}
                >
                  {t.due_date === today ? "today" : "overdue"}
                </span>
                <span className="flex-1 truncate text-foreground">
                  {t.title}
                </span>
              </li>
            ))}
          </ul>
        </Column>

        <Column
          icon={Flame}
          label="Habits left"
          empty={
            streaks.length === 0
              ? "No habits yet."
              : "All done today."
          }
          isEmpty={
            streaks.length === 0 ||
            (atRisk.length === 0 && otherUnchecked.length === 0)
          }
        >
          <ul className="space-y-1.5">
            {atRisk.slice(0, 4).map(({ streak: s, count }) => (
              <li key={s.id} className="flex items-center gap-2 text-sm">
                <span
                  className="h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ background: s.color }}
                />
                <span className="flex-1 truncate text-foreground">
                  {s.name}
                </span>
                <span className="text-[11px] text-warning font-medium tabular shrink-0">
                  {count}d at risk
                </span>
              </li>
            ))}
            {otherUnchecked
              .slice(0, Math.max(0, 4 - atRisk.length))
              .map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-sm">
                  <span
                    className="h-1.5 w-1.5 rounded-full shrink-0"
                    style={{ background: s.color }}
                  />
                  <span className="flex-1 truncate text-foreground-muted">
                    {s.name}
                  </span>
                </li>
              ))}
          </ul>
        </Column>
      </div>
    </section>
  );
}

function Column({
  icon: Icon,
  label,
  children,
  empty,
  isEmpty,
  isError,
  relink,
}: {
  icon: typeof Sun;
  label: string;
  children: React.ReactNode;
  empty: string;
  isEmpty?: boolean;
  isError?: boolean;
  relink?: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <SectionLabel className="flex items-center gap-1.5">
        <Icon className="h-3 w-3" />
        {label}
      </SectionLabel>
      {isEmpty || isError ? (
        <div>
          <p className="text-xs text-foreground-subtle">{empty}</p>
          {relink && <div className="mt-2">{relink}</div>}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
