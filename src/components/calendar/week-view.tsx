"use client";

import { useMemo } from "react";
import { format, isSameDay } from "date-fns";
import { CalendarDays, ExternalLink, MapPin, Repeat } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  eventStart,
  eventTimeLabel,
  type EventsResult,
  type GcalEvent,
} from "@/lib/calendar";
import { RelinkGoogleButton } from "@/components/calendar/relink-cta";
import { CalendarPicker } from "@/components/calendar/calendar-picker";
import { useDict, useDateLocale } from "@/lib/i18n";

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
  return [...buckets.values()].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
}

export function WeekView({
  calendar,
  selectedCalendarIds,
}: {
  calendar: EventsResult;
  selectedCalendarIds: string[];
}) {
  const t = useDict();
  const locale = useDateLocale();
  const buckets = useMemo(
    () => (calendar.ok ? bucketByDay(calendar.events) : []),
    [calendar],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="inline-flex items-center gap-1.5">
          <CalendarDays className="h-3 w-3" /> {t.calendar.next7Days}
        </CardTitle>
        <CalendarPicker initialSelected={selectedCalendarIds} />
      </CardHeader>
      <CardContent>
        {!calendar.ok ? (
          <div className="space-y-3">
            <p className="text-sm text-foreground-muted">
              {calendar.reason === "unauthorized"
                ? t.calendar.errUnauthorized
                : calendar.reason === "no-token"
                  ? t.calendar.errNoToken
                  : t.calendar.errLoad}
            </p>
            <RelinkGoogleButton
              reason={
                calendar.reason === "unauthorized" ? "expired" : "calendar-access"
              }
            />
          </div>
        ) : buckets.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={t.calendar.nothingScheduled}
            description={t.calendar.weekWideOpen}
          />
        ) : (
          <ul className="space-y-5">
            {buckets.map((b) => {
              const today = isSameDay(b.date, new Date());
              return (
                <li key={b.key}>
                  <p
                    className={
                      "text-[11px] font-semibold uppercase tracking-wider mb-2 " +
                      (today
                        ? "text-success"
                        : "text-foreground-muted")
                    }
                  >
                    {today
                      ? t.calendar.today
                      : format(b.date, t.calendar.dayHeadingFormat, { locale })}
                  </p>
                  <ul className="space-y-1.5">
                    {b.events.map((ev) => (
                      <li
                        key={ev.id}
                        className="group flex items-start gap-2 text-sm rounded-md -mx-1.5 px-1.5 py-1 row-hover"
                      >
                        <span className="font-mono text-[11px] text-foreground-subtle w-12 shrink-0 pt-0.5 tabular">
                          {ev.start.date && !ev.start.dateTime
                            ? t.calendar.allDayLabel
                            : eventTimeLabel(ev)}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block truncate text-foreground">
                            {ev.summary ?? t.calendar.noTitle}
                          </span>
                          {ev.description && (
                            <span className="block truncate text-[11px] text-foreground-subtle mt-0.5">
                              {ev.description.replace(/<[^>]*>/g, "").slice(0, 120)}
                            </span>
                          )}
                          {(ev.location || ev.recurringEventId) && (
                            <span className="flex items-center gap-2 text-[11px] text-foreground-subtle mt-0.5">
                              {ev.recurringEventId && (
                                <span className="inline-flex items-center gap-1">
                                  <Repeat className="h-2.5 w-2.5" />
                                  {t.calendar.repeats}
                                </span>
                              )}
                              {ev.location && (
                                <span className="inline-flex items-center gap-1 truncate">
                                  <MapPin className="h-2.5 w-2.5" />
                                  <span className="truncate">
                                    {ev.location}
                                  </span>
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
                            className="text-foreground-subtle hover:text-foreground transition-colors pt-0.5 opacity-0 group-hover:opacity-100"
                            aria-label={t.calendar.openInGoogleCalendar}
                          >
                            <ExternalLink className="h-3 w-3" />
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
