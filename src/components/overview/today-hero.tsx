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
import { Card, CardContent } from "@/components/ui/card";
import {
  streaksUncheckedToday,
  todayStr,
  uncheckedTodayWithCounts,
} from "@/lib/streaks";
import { useNow } from "@/lib/use-now";
import { nextUpcoming } from "@/lib/important-dates";
import type { ImportantDate, Streak, StreakLog, Todo } from "@/lib/types";
import type { EventsResult, GcalEvent } from "@/lib/calendar";
import { RelinkGoogleButton } from "@/components/calendar/relink-cta";

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

function eventStart(ev: GcalEvent): Date | null {
  if (ev.start.dateTime) return new Date(ev.start.dateTime);
  if (ev.start.date) return new Date(`${ev.start.date}T00:00:00`);
  return null;
}

function eventEnd(ev: GcalEvent): Date | null {
  if (ev.end.dateTime) return new Date(ev.end.dateTime);
  if (ev.end.date) return new Date(`${ev.end.date}T23:59:59`);
  return null;
}

function eventTimeLabel(ev: GcalEvent): string {
  if (ev.start.date && !ev.start.dateTime) return "all day";
  if (ev.start.dateTime) return format(new Date(ev.start.dateTime), "HH:mm");
  return "";
}

function eventDateKey(ev: GcalEvent): string | null {
  if (ev.start.dateTime) return format(new Date(ev.start.dateTime), "yyyy-MM-dd");
  if (ev.start.date) return ev.start.date;
  return null;
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
  const today = todayStr();

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
    () =>
      todos.filter(
        (t) => !t.done && t.due_date && t.due_date <= today,
      ),
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
    <Card>
      <CardContent className="pt-6">
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-zinc-600 dark:text-zinc-400"
          suppressHydrationWarning
        >
          {greeting ? (
            <>
              <greeting.Icon className="h-4 w-4" />
              <span className="text-sm font-medium">
                {greeting.text}, {firstName}
              </span>
            </>
          ) : (
            <span className="text-sm font-medium">Welcome, {firstName}</span>
          )}
          <span className="text-sm text-zinc-400 dark:text-zinc-500">
            ·{" "}
            {now
              ? `${format(display, "EEEE, MMMM d")} · ${format(display, "HH:mm")}`
              : "Loading…"}
          </span>
          {nextUp && !ongoing && (
            <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">
              Next:{" "}
              <span className="font-medium text-zinc-700 dark:text-zinc-200">
                {nextUp.ev.summary ?? "(no title)"}
              </span>{" "}
              {formatCountdown(nextUp.minutes)}
            </span>
          )}
          {ongoing && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-xs">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span className="text-zinc-700 dark:text-zinc-200 font-medium">
                {ongoing.summary ?? "(no title)"}
              </span>
              <span className="text-zinc-500">happening now</span>
            </span>
          )}
        </div>

        {upcoming && upcoming.daysUntil <= 60 && (
          <p className="mt-2 text-xs text-zinc-500 inline-flex items-center gap-1.5">
            <span className="text-base leading-none">
              {upcoming.date.emoji ?? "📌"}
            </span>
            <span className="font-medium text-zinc-700 dark:text-zinc-200">
              {upcoming.date.title}
            </span>
            <span>
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

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <section>
            <h3 className="text-xs font-medium text-zinc-500 flex items-center gap-1.5 mb-2">
              <CalendarDays className="h-3.5 w-3.5" /> Today&apos;s events
            </h3>
            {!calendar.ok ? (
              <div className="space-y-2">
                <p className="text-xs text-zinc-400">
                  {calendar.reason === "unauthorized"
                    ? "Google rejected the calendar token."
                    : calendar.reason === "no-token"
                      ? "Grant Calendar access to see today's events."
                      : "Couldn't load events."}
                </p>
                {(calendar.reason === "unauthorized" ||
                  calendar.reason === "no-token") && (
                  <RelinkGoogleButton
                    reason={
                      calendar.reason === "unauthorized" ? "expired" : "calendar-access"
                    }
                  />
                )}
              </div>
            ) : todayEvents.length === 0 ? (
              <p className="text-xs text-zinc-400">Nothing scheduled.</p>
            ) : (
              <ul className="space-y-1.5">
                {todayEvents.slice(0, 4).map((ev) => {
                  const isOngoing = ongoing?.id === ev.id;
                  return (
                    <li
                      key={ev.id}
                      className={
                        "text-sm flex gap-2 " +
                        (isOngoing
                          ? "rounded-md bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1"
                          : "")
                      }
                    >
                      <span className="font-mono text-xs text-zinc-500 w-12 shrink-0 pt-0.5">
                        {eventTimeLabel(ev)}
                      </span>
                      <span className="truncate flex-1">
                        {ev.summary ?? "(no title)"}
                      </span>
                      {isOngoing && (
                        <span className="text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400 pt-0.5">
                          now
                        </span>
                      )}
                      {ev.htmlLink && (
                        <a
                          href={ev.htmlLink}
                          target="_blank"
                          rel="noreferrer"
                          className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
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
          </section>

          <section>
            <h3 className="text-xs font-medium text-zinc-500 flex items-center gap-1.5 mb-2">
              <ListTodo className="h-3.5 w-3.5" /> Due today
            </h3>
            {dueToday.length === 0 ? (
              <p className="text-xs text-zinc-400">Nothing due.</p>
            ) : (
              <ul className="space-y-1.5">
                {dueToday.slice(0, 4).map((t) => (
                  <li key={t.id} className="text-sm flex gap-2">
                    <span
                      className={
                        "font-mono text-xs w-14 shrink-0 pt-0.5 " +
                        (t.due_date && t.due_date < today
                          ? "text-red-500"
                          : "text-zinc-500")
                      }
                    >
                      {t.due_date === today ? "today" : "overdue"}
                    </span>
                    <span className="truncate">{t.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="text-xs font-medium text-zinc-500 flex items-center gap-1.5 mb-2">
              <Flame className="h-3.5 w-3.5" /> Streaks left today
            </h3>
            {streaks.length === 0 ? (
              <p className="text-xs text-zinc-400">No streaks yet.</p>
            ) : atRisk.length === 0 && otherUnchecked.length === 0 ? (
              <p className="text-xs text-emerald-600">All done.</p>
            ) : (
              <ul className="space-y-1.5">
                {atRisk.slice(0, 4).map(({ streak: s, count }) => (
                  <li key={s.id} className="text-sm flex items-center gap-2">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ background: s.color }}
                    />
                    <span className="truncate flex-1">{s.name}</span>
                    <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium shrink-0">
                      {count}-day streak at risk
                    </span>
                  </li>
                ))}
                {otherUnchecked.slice(0, Math.max(0, 4 - atRisk.length)).map((s) => (
                  <li key={s.id} className="text-sm flex items-center gap-2">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ background: s.color }}
                    />
                    <span className="truncate">{s.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </CardContent>
    </Card>
  );
}
