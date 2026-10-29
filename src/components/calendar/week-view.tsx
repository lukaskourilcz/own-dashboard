"use client";

import { useMemo, useState } from "react";
import { format, isSameDay } from "date-fns";
import { CalendarDays, ExternalLink, MapPin, Repeat } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  eventStart,
  calendarDescriptionSnippet,
  eventTimeLabel,
  type EventsResult,
  type GcalEvent,
} from "@/lib/calendar";
import { RelinkGoogleButton } from "@/components/calendar/relink-cta";
import { CalendarPicker } from "@/components/calendar/calendar-picker";
import { useDict, useDateLocale } from "@/lib/i18n";
import { useNow } from "@/lib/use-now";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { qk } from "@/lib/queries/keys";

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
  const qc = useQueryClient();
  const locale = useDateLocale();
  const now = useNow();
  const hydrated = now !== null;
  const [visibleCount, setVisibleCount] = useState(50);
  const buckets = useMemo(
    () => (hydrated && calendar.ok ? bucketByDay(calendar.events) : []),
    [calendar, hydrated],
  );
  const visibleBuckets = useMemo(() => {
    let remaining = visibleCount;
    const visible: DayBucket[] = [];
    for (const bucket of buckets) {
      if (remaining <= 0) break;
      const events = bucket.events.slice(0, remaining);
      remaining -= events.length;
      if (events.length) visible.push({ ...bucket, events });
    }
    return visible;
  }, [buckets, visibleCount]);
  const total = calendar.ok ? calendar.events.length : 0;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle role="heading" aria-level={2} className="inline-flex items-center gap-1.5">
          <CalendarDays className="h-3 w-3" /> {t.calendar.next7Days}
        </CardTitle>
        <CalendarPicker initialSelected={selectedCalendarIds} />
      </CardHeader>
      <CardContent>
        {!hydrated ? <p role="status" className="text-sm text-foreground-muted">{t.common.loading}</p> : !calendar.ok ? (
          <div className="space-y-3">
            <p className="text-sm text-foreground-muted">
              {calendar.reason === "unauthorized"
                ? t.calendar.errUnauthorized
                : calendar.reason === "no-token"
                  ? t.calendar.errNoToken
                  : t.calendar.errLoad}
            </p>
            {calendar.reason === "error" ? <Button variant="outline" size="sm" onClick={() => void qc.invalidateQueries({ queryKey: qk.calendarWeek })}>{t.calendar.retry}</Button> : <RelinkGoogleButton
              reason={
                calendar.reason === "unauthorized" ? "expired" : "calendar-access"
              }
            />}
          </div>
        ) : buckets.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={t.calendar.nothingScheduled}
            description={t.calendar.weekWideOpen}
          />
        ) : (
          <div className="space-y-3">
          <ul className="space-y-5">
            {visibleBuckets.map((b) => {
              const today = isSameDay(b.date, now!);
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
                        key={`${ev.sourceCalendarId ?? "primary"}:${ev.id}`}
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
                              {calendarDescriptionSnippet(ev.description, 120)}
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
                            className="inline-flex min-h-11 min-w-11 md:min-h-6 md:min-w-6 items-center justify-center text-foreground-subtle hover:text-foreground transition-colors md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 focus-ring"
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
          {total > 50 && <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-foreground-muted" role="status">{t.calendar.showingEvents(Math.min(total, visibleCount), total)}</p>{visibleCount < total && <Button variant="outline" size="sm" onClick={() => setVisibleCount(count => count + 50)}>{t.calendar.showMore}</Button>}</div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
