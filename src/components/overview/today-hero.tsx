"use client";

import { useMemo } from "react";
import { format } from "date-fns";
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
import { streaksUncheckedToday, todayStr } from "@/lib/streaks";
import type { Streak, StreakLog, Todo } from "@/lib/types";
import type { GcalEvent, TodayEventsResult } from "@/lib/calendar";

type Props = {
  userName: string | null;
  userEmail: string;
  calendar: TodayEventsResult;
  todos: Todo[];
  streaks: Streak[];
  streakLogs: StreakLog[];
};

function greeting(): { text: string; Icon: typeof Sun } {
  const hour = new Date().getHours();
  if (hour < 12) return { text: "Good morning", Icon: Sunrise };
  if (hour < 18) return { text: "Good afternoon", Icon: Sun };
  return { text: "Good evening", Icon: Moon };
}

function eventTime(ev: GcalEvent): string {
  if (ev.start.date && !ev.start.dateTime) return "all day";
  const dt = ev.start.dateTime;
  if (!dt) return "";
  return format(new Date(dt), "HH:mm");
}

function eventDateKey(ev: GcalEvent): string | null {
  if (ev.start.dateTime) return format(new Date(ev.start.dateTime), "yyyy-MM-dd");
  if (ev.start.date) return ev.start.date;
  return null;
}

export function TodayHero({
  userName,
  userEmail,
  calendar,
  todos,
  streaks,
  streakLogs,
}: Props) {
  const { text: greetingText, Icon: GreetingIcon } = greeting();
  const dateText = format(new Date(), "EEEE, MMMM d");
  const firstName = (userName?.trim() || userEmail).split(/[\s@]/)[0];
  const today = todayStr();

  const todayEvents = useMemo(() => {
    if (!calendar.ok) return [];
    return calendar.events.filter((ev) => eventDateKey(ev) === today);
  }, [calendar, today]);

  const dueToday = useMemo(
    () =>
      todos.filter(
        (t) => !t.done && t.due_date && t.due_date <= today,
      ),
    [todos, today],
  );

  const unchecked = useMemo(
    () => streaksUncheckedToday(streaks, streakLogs),
    [streaks, streakLogs],
  );

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
          <GreetingIcon className="h-4 w-4" />
          <span className="text-sm font-medium">
            {greetingText}, {firstName}
          </span>
          <span className="text-sm text-zinc-400 dark:text-zinc-500">
            · {dateText}
          </span>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <section>
            <h3 className="text-xs font-medium text-zinc-500 flex items-center gap-1.5 mb-2">
              <CalendarDays className="h-3.5 w-3.5" /> Today&apos;s events
            </h3>
            {!calendar.ok ? (
              <p className="text-xs text-zinc-400">
                {calendar.reason === "no-token" || calendar.reason === "unauthorized"
                  ? "Sign out and back in to read Google Calendar."
                  : "Couldn't load events."}
              </p>
            ) : todayEvents.length === 0 ? (
              <p className="text-xs text-zinc-400">Nothing scheduled.</p>
            ) : (
              <ul className="space-y-1.5">
                {todayEvents.slice(0, 4).map((ev) => (
                  <li key={ev.id} className="text-sm flex gap-2">
                    <span className="font-mono text-xs text-zinc-500 w-12 shrink-0 pt-0.5">
                      {eventTime(ev)}
                    </span>
                    <span className="truncate flex-1">
                      {ev.summary ?? "(no title)"}
                    </span>
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
                ))}
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
            ) : unchecked.length === 0 ? (
              <p className="text-xs text-emerald-600">All done. </p>
            ) : (
              <ul className="space-y-1.5">
                {unchecked.slice(0, 4).map((s) => (
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
