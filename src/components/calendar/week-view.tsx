"use client";

import { useMemo } from "react";
import { format, isSameDay } from "date-fns";
import { CalendarDays, ExternalLink, MapPin, Repeat } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EventsResult, GcalEvent } from "@/lib/calendar";
import { RelinkGoogleButton } from "@/components/calendar/relink-cta";

function eventStart(ev: GcalEvent): Date | null {
  if (ev.start.dateTime) return new Date(ev.start.dateTime);
  if (ev.start.date) return new Date(`${ev.start.date}T00:00:00`);
  return null;
}

function eventTimeLabel(ev: GcalEvent): string {
  if (ev.start.date && !ev.start.dateTime) return "all day";
  if (ev.start.dateTime) return format(new Date(ev.start.dateTime), "HH:mm");
  return "";
}

type DayBucket = { key: string; date: Date; events: GcalEvent[] };

function bucketByDay(events: GcalEvent[]): DayBucket[] {
  const buckets = new Map<string, DayBucket>();
  for (const ev of events) {
    const start = eventStart(ev);
    if (!start) continue;
    const key = format(start, "yyyy-MM-dd");
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, date: start, events: [] };
      buckets.set(key, bucket);
    }
    bucket.events.push(ev);
  }
  for (const b of buckets.values()) {
    b.events.sort((a, b) => {
      const ta = eventStart(a)?.getTime() ?? 0;
      const tb = eventStart(b)?.getTime() ?? 0;
      return ta - tb;
    });
  }
  return [...buckets.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function WeekView({ calendar }: { calendar: EventsResult }) {
  const buckets = useMemo(
    () => (calendar.ok ? bucketByDay(calendar.events) : []),
    [calendar],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4" /> Next 7 days
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!calendar.ok ? (
          <div className="space-y-2">
            <p className="text-sm text-zinc-500">
              {calendar.reason === "unauthorized"
                ? "Google rejected the calendar token — it likely expired."
                : calendar.reason === "no-token"
                  ? "We don't have a Calendar token yet."
                  : "Couldn't load events from Google."}
            </p>
            <RelinkGoogleButton
              reason={calendar.reason === "unauthorized" ? "expired" : "calendar-access"}
            />
          </div>
        ) : buckets.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing scheduled this week.</p>
        ) : (
          <ul className="space-y-4">
            {buckets.map((b) => {
              const today = isSameDay(b.date, new Date());
              return (
                <li key={b.key}>
                  <p
                    className={
                      "text-xs uppercase tracking-wide mb-2 " +
                      (today
                        ? "text-emerald-600 dark:text-emerald-400 font-semibold"
                        : "text-zinc-500")
                    }
                  >
                    {today ? "Today" : format(b.date, "EEEE, MMM d")}
                  </p>
                  <ul className="space-y-1.5">
                    {b.events.map((ev) => (
                      <li key={ev.id} className="text-sm flex gap-2 items-start">
                        <span className="font-mono text-xs text-zinc-500 w-12 shrink-0 pt-0.5">
                          {eventTimeLabel(ev)}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block truncate">
                            {ev.summary ?? "(no title)"}
                          </span>
                          {(ev.location || ev.recurringEventId) && (
                            <span className="block text-xs text-zinc-400 mt-0.5 flex items-center gap-2">
                              {ev.recurringEventId && (
                                <span className="inline-flex items-center gap-1">
                                  <Repeat className="h-3 w-3" />
                                  repeats
                                </span>
                              )}
                              {ev.location && (
                                <span className="inline-flex items-center gap-1 truncate">
                                  <MapPin className="h-3 w-3" />
                                  <span className="truncate">{ev.location}</span>
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                        {ev.htmlLink && (
                          <a
                            href={ev.htmlLink}
                            target="_blank"
                            rel="noreferrer"
                            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 pt-0.5"
                            aria-label="Open in Google Calendar"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
