"use client";

import { useMemo, useState } from "react";
import { differenceInCalendarDays, format } from "date-fns";
import { CalendarSourceNotes } from "@/components/marketing/calendar-source-notes";
import { useMarketingCalendars } from "@/components/marketing/use-marketing-calendars";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { parseDateOnly, todayKey } from "@/lib/date-keys";
import { useDateLocale, useDict, useLang } from "@/lib/i18n";
import { MARKETING_CALENDAR_SOURCES, marketingWeek, type MarketingCalendarsResponse, type WeekEntry } from "@/lib/marketing-calendars";
import type { StatusTone } from "@/lib/status-presentation";
import { useNow } from "@/lib/use-now";

/**
 * Calendar statuses read as neutral badges: the success and information
 * badge tones miss 4.5:1 at this size, and a status here is information to
 * read, not an alert. Only a blocked entry stands out.
 */
const STATUS_TONE: Record<string, StatusTone> = { blocked: "destructive" };

/** Entries shown before "Show all": two busy calendars fill a week with ~70. */
const WEEK_PAGE = 20;

/**
 * The owner's one cross-project view of the marketing plans: the next seven
 * days of every calendar in `MARKETING_CALENDAR_SOURCES`, read-only, each row
 * linking out to the calendar that owns it. Before a launch it counts down to
 * the first day and lists the pre-launch items due this week.
 */
export function MarketingWeekCard({ preview }: { preview?: MarketingCalendarsResponse }) {
  const t = useDict();
  const m = t.marketing;
  const { lang } = useLang();
  const locale = useDateLocale();
  const now = useNow();
  const { view, checking, canCheck, checkAgain } = useMarketingCalendars(preview);
  const [showAll, setShowAll] = useState(false);
  const today = now ? todayKey(now) : null;
  const week = useMemo(
    () => (view.kind === "ok" && today ? marketingWeek(view.data.sources, today) : null),
    [view, today],
  );
  const day = (key: string) => format(parseDateOnly(key), lang === "cs" ? "EEE d. M." : "EEE d MMM", { locale });
  const label = (map: Record<string, string>, value: string) => map[value] ?? value;
  const sources = view.kind === "ok" ? view.data.sources : [];
  const readable = sources.filter((source) => source.status === "ok");
  const checkedAt =
    view.kind === "ok"
      ? new Date(view.data.checkedAt).toLocaleTimeString(lang === "cs" ? "cs-CZ" : "en-GB", { hour: "2-digit", minute: "2-digit" })
      : null;

  const shownEntries = week ? (showAll ? week.entries : week.entries.slice(0, WEEK_PAGE)) : [];
  const byDay = new Map<string, WeekEntry[]>();
  for (const entry of shownEntries) byDay.set(entry.date, [...(byDay.get(entry.date) ?? []), entry]);

  return (
    <Card data-marketing-week aria-busy={checking}>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {m.weekTitle}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-foreground-muted">{m.weekDescription}</p>

        {view.kind === "loading" || (view.kind === "ok" && !week) ? (
          <div aria-live="polite" className="space-y-2">
            <p className="text-xs text-foreground-muted">{m.loading}</p>
            <Skeleton className="h-10 w-full" />
          </div>
        ) : view.kind !== "ok" ? (
          <p role="alert" className="text-sm text-destructive">
            {view.kind === "rate-limited" ? m.rateLimited : view.kind === "signed-out" ? m.signedOut : m.loadError}
          </p>
        ) : (
          <>
            <CalendarSourceNotes sources={sources} />
            {readable.length === 0 ? (
              <p className="text-sm text-foreground-muted">{m.nothingRead}</p>
            ) : (
              week && (
                <>
                  {week.upcomingLaunch && today && (
                    <p data-marketing-launch className="text-sm font-medium">
                      {m.startsOn(day(week.upcomingLaunch.date))}
                      <span className="font-normal text-foreground-muted">
                        {" · "}
                        {m.daysToLaunch(differenceInCalendarDays(parseDateOnly(week.upcomingLaunch.date), parseDateOnly(today)))}
                        {readable.length > 1 && week.upcomingLaunch.labels.length < readable.length
                          ? ` · ${week.upcomingLaunch.labels.join(", ")}`
                          : ""}
                      </span>
                    </p>
                  )}

                  {(week.upcomingLaunch || week.prelaunch.length > 0) && (
                    <section aria-labelledby="marketing-prelaunch" className="space-y-1.5">
                      <h3 id="marketing-prelaunch" className="text-xs font-semibold text-foreground">{m.prelaunchTitle}</h3>
                      {week.prelaunch.length === 0 ? (
                        <p className="text-xs text-foreground-muted">{m.noPrelaunch}</p>
                      ) : (
                        <ul className="divide-y divide-border">
                          {week.prelaunch.map((item) => (
                            <li key={`${item.sourceId}:${item.id}`} data-marketing-prelaunch={item.id} className="py-2">
                              <div className="flex items-start justify-between gap-3">
                                <a
                                  href={item.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="focus-ring inline-flex min-h-11 min-w-0 items-center rounded text-sm font-medium hover:underline sm:min-h-0 [overflow-wrap:anywhere]"
                                >
                                  {item.title}
                                  <span className="sr-only"> {m.opensInNewTab}</span>
                                </a>
                                <span className="flex shrink-0 flex-wrap justify-end gap-1">
                                  {item.overdue && <StatusBadge value="overdue" label={m.prelaunchOverdue} tone="warning" />}
                                  <StatusBadge value={item.status} label={label(m.status, item.status)} tone={STATUS_TONE[item.status] ?? "neutral"} />
                                </span>
                              </div>
                              <p className="mt-0.5 text-xs text-foreground-muted [overflow-wrap:anywhere]">
                                {[
                                  day(item.due),
                                  item.label,
                                  item.owner ? label(m.prelaunchOwner, item.owner) : null,
                                  item.repo && item.issue ? `${item.repo}${item.issue}` : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  )}

                  {week.entries.length === 0 ? (
                    !week.upcomingLaunch && <p className="text-sm text-foreground-muted">{m.noEntries}</p>
                  ) : (
                    <div id="marketing-week-entries" className="space-y-3">
                      {[...byDay].map(([date, entries]) => (
                        <section key={date} aria-labelledby={`marketing-day-${date}`}>
                          <h3 id={`marketing-day-${date}`} className="border-b border-border pb-1 text-xs font-semibold tabular text-foreground">
                            {day(date)}
                          </h3>
                          <ul className="divide-y divide-border">
                            {entries.map((entry) => (
                              <li key={`${entry.sourceId}:${entry.id}`} data-marketing-entry={entry.id} className="py-2">
                                <div className="flex items-start justify-between gap-3">
                                  <a
                                    href={entry.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="focus-ring inline-flex min-h-11 min-w-0 items-center rounded text-sm font-medium hover:underline sm:min-h-0 [overflow-wrap:anywhere]"
                                  >
                                    {entry.title}
                                    <span className="sr-only"> {m.opensInNewTab}</span>
                                  </a>
                                  <StatusBadge
                                    value={entry.status}
                                    label={label(m.status, entry.status)}
                                    tone={STATUS_TONE[entry.status] ?? "neutral"}
                                    className="shrink-0"
                                  />
                                </div>
                                <p className="mt-0.5 text-xs text-foreground-muted [overflow-wrap:anywhere]">
                                  {[entry.time, entry.label, label(m.platform, entry.platform), label(m.kind, entry.kind)]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </p>
                              </li>
                            ))}
                          </ul>
                        </section>
                      ))}
                      {week.entries.length > WEEK_PAGE && (
                        <Button
                          size="sm"
                          variant="outline"
                          aria-controls="marketing-week-entries"
                          aria-expanded={showAll}
                          onClick={() => setShowAll((value) => !value)}
                          className="min-h-11 sm:min-h-0"
                        >
                          {showAll ? m.showFewer : m.showAll(week.entries.length)}
                        </Button>
                      )}
                    </div>
                  )}
                </>
              )
            )}
          </>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2">
          {MARKETING_CALENDAR_SOURCES.map((source) => (
            <a
              key={source.id}
              href={source.calendarUrl}
              target="_blank"
              rel="noreferrer"
              className="focus-ring inline-flex min-h-11 items-center rounded text-xs font-medium underline hover:no-underline sm:min-h-0"
            >
              {m.openCalendar(source.label)}
              <span className="sr-only"> {m.opensInNewTab}</span>
            </a>
          ))}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {checkedAt && <span className="text-[11px] tabular text-foreground-subtle">{m.checkedAt(checkedAt)}</span>}
            <Button size="sm" variant="outline" onClick={checkAgain} disabled={checking || !canCheck} className="min-h-11 sm:min-h-0">
              {checking ? m.checking : m.checkAgain}
            </Button>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
