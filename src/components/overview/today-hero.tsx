"use client";

import { useMemo } from "react";
import { differenceInMinutes, format } from "date-fns";
import {
  BriefcaseBusiness,
  CalendarDays,
  ExternalLink,
  ListTodo,
  Moon,
  Sun,
  Sunrise,
} from "lucide-react";
import { SectionLabel } from "@/components/ui/page-header";
import { daysUntilDate, todayKey } from "@/lib/date-keys";
import { useNow } from "@/lib/use-now";
import { nextUpcoming } from "@/lib/important-dates";
import { useDict, useDateLocale, type Dict } from "@/lib/i18n";
import type { ClientOpportunity, ImportantDate, Todo } from "@/lib/types";
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
  opportunities: ClientOpportunity[];
  importantDates: ImportantDate[];
};

function greetingFor(date: Date, t: Dict): { text: string; Icon: typeof Sun } {
  const hour = date.getHours();
  if (hour < 12) return { text: t.overview.goodMorning, Icon: Sunrise };
  if (hour < 18) return { text: t.overview.goodAfternoon, Icon: Sun };
  return { text: t.overview.goodEvening, Icon: Moon };
}

function formatCountdown(minutes: number, t: Dict): string {
  if (minutes < 1) return t.overview.countdownNow;
  if (minutes < 60) return t.overview.inMinutes(minutes);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? t.overview.inHours(h) : t.overview.inHoursMinutes(h, m);
}

export function TodayHero({
  userName,
  userEmail,
  calendar,
  todos,
  opportunities,
  importantDates,
}: Props) {
  const t = useDict();
  const locale = useDateLocale();
  const now = useNow();
  const display = now ?? new Date(0);
  const greeting = now ? greetingFor(now, t) : null;
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

  // Tasks with a deadline, soonest first: overdue + due within the next week.
  // Shows the "time to finish" so the 7-day NEEDED timers surface here.
  const dueSoon = useMemo(() => {
    if (!now) return [];
    return todos
      .filter(
        (td) => !td.done && td.due_date && daysUntilDate(td.due_date, now) <= 7,
      )
      .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
  }, [todos, now]);

  const followUps = useMemo(() => opportunities
    .filter((item) => !["won", "lost", "expired", "archived"].includes(item.status) && item.next_follow_up_at)
    .sort((a, b) => (a.next_follow_up_at ?? "").localeCompare(b.next_follow_up_at ?? "")), [opportunities]);

  const upcoming = useMemo(
    () => (now ? nextUpcoming(importantDates, now) : null),
    [importantDates, now],
  );

  return (
    <section
      className="relative overflow-hidden rounded-lg border border-border bg-surface p-5 md:p-7"
      suppressHydrationWarning
    >
      <div aria-hidden className="operational-grid pointer-events-none absolute inset-0 opacity-50" />
      <div className="relative">
      {/* greeting row */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground">
            {greeting ? greeting.text : t.overview.welcome}, {firstName}
          </h1>
          <p className="mt-1 text-sm text-foreground-muted tabular">
            {now
              ? format(display, t.overview.dateFormat, { locale })
              : t.common.loading}
          </p>
        </div>

        {/* "now" pill */}
        {ongoing ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-muted px-3 py-1.5 text-xs">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-60 animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
            </span>
            <span className="text-foreground-muted">{t.overview.now}</span>
            <span className="font-medium text-foreground truncate max-w-[180px]">
              {ongoing.summary ?? t.overview.noTitle}
            </span>
          </div>
        ) : nextUp ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-muted px-3 py-1.5 text-xs">
            <span className="text-foreground-muted">{t.overview.next}</span>
            <span className="font-medium text-foreground truncate max-w-[180px]">
              {nextUp.ev.summary ?? t.overview.noTitle}
            </span>
            <span className="text-foreground-subtle tabular">
              {formatCountdown(nextUp.minutes, t)}
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
              ? t.overview.isToday
              : upcoming.daysUntil === 1
                ? t.overview.tomorrow
                : t.overview.inDays(upcoming.daysUntil)}
            {upcoming.yearsCompleted !== null && upcoming.yearsCompleted > 0
              ? ` · ${t.overview.yearN(upcoming.yearsCompleted + 1)}`
              : ""}
          </span>
        </p>
      )}

      {/* three columns */}
      <div className="mt-6 grid gap-6 md:grid-cols-3">
        <Column
          icon={CalendarDays}
          label={t.overview.todaysEvents}
          empty={
            !calendar.ok
              ? calendar.reason === "unauthorized"
                ? t.overview.calendarTokenExpired
                : calendar.reason === "no-token"
                  ? t.overview.grantCalendarAccess
                  : t.overview.couldntLoadEvents
              : t.overview.nothingScheduled
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
                      {ev.start.date && !ev.start.dateTime
                        ? t.calendar.allDayLabel
                        : eventTimeLabel(ev)}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span
                        className={cn(
                          "block truncate",
                          isOngoing && "font-medium text-foreground",
                        )}
                      >
                        {ev.summary ?? t.overview.noTitle}
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
                        aria-label={t.overview.openInGoogleCalendar}
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
          label={t.overview.dueSoon}
          empty={t.overview.nothingDue}
          isEmpty={dueSoon.length === 0}
        >
          <ul className="space-y-1.5">
            {dueSoon.slice(0, 4).map((td) => {
              const left = td.due_date ? daysUntilDate(td.due_date, display) : 0;
              return (
                <li key={td.id} className="flex items-start gap-2 text-sm">
                  <span
                    className={cn(
                      "tabular text-xs w-14 shrink-0 pt-0.5",
                      left < 0
                        ? "text-destructive font-medium"
                        : left === 0
                          ? "text-warning font-medium"
                          : "text-foreground-subtle",
                    )}
                  >
                    {left === 0
                      ? t.overview.dueTodayTag
                      : t.overview.daysTag(left)}
                  </span>
                  <span className="flex-1 truncate text-foreground">
                    {td.title}
                  </span>
                </li>
              );
            })}
          </ul>
        </Column>

        <Column
          icon={BriefcaseBusiness}
          label={t.overview.followUps}
          empty={t.overview.noFollowUps}
          isEmpty={followUps.length === 0}
        >
          <ul className="space-y-1.5">
            {followUps.slice(0, 4).map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate text-foreground">{item.title}</span>
                <span className="text-[11px] text-foreground-subtle tabular shrink-0">
                  {item.next_follow_up_at?.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        </Column>
      </div>
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
