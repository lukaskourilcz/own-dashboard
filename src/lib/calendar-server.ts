import "server-only";
import { createGoogleFetcher } from "@/lib/google-token";
import { createClient } from "@/lib/supabase/server";
import { loadUserPreferences } from "@/lib/user-prefs";
import { awaitWithSignal } from "@/lib/abortable";
import { CalendarReadError, readGooglePages, type CalendarReadBudget } from "@/lib/calendar-google-read";
import { calendarEventPage } from "@/lib/calendar-response";
import { eventStart, type EventsResult, type GcalEvent } from "@/lib/calendar";

type ReadContext = { userId: string; signal?: AbortSignal };
const EVENT_FIELDS = "nextPageToken,items(id,status,summary,description,start,end,htmlLink,location,recurrence,recurringEventId)";

async function fetchWindow(timeMin: Date, timeMax: Date, context?: ReadContext): Promise<EventsResult> {
  const stop = new AbortController();
  const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(20_000), ...(context?.signal ? [context.signal] : [])]);
  try {
    let userId = context?.userId;
    if (!userId) {
      const supabase = await awaitWithSignal(createClient(signal), signal);
      const auth = await awaitWithSignal(supabase.auth.getUser(), signal);
      if (auth.error) throw new CalendarReadError();
      if (!auth.data.user) return { ok: false, reason: "no-token" };
      userId = auth.data.user.id;
    }
    const prefs = await loadUserPreferences(userId, signal);
    if (!prefs.sync_available) throw new CalendarReadError();
    const ids = [...new Set(prefs.selected_calendar_ids.length ? prefs.selected_calendar_ids : ["primary"])];
    const fetcher = createGoogleFetcher(userId, signal);
    const budget: CalendarReadBudget = { pages: 40, items: 2000, characters: 8_388_608 };
    const merged: GcalEvent[] = [];
    let cursor = 0, failure: unknown;
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
      while (cursor < ids.length && !failure) {
        const calendarId = ids[cursor++];
        try {
          const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
          for (const [key, value] of Object.entries({ timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250", fields: EVENT_FIELDS })) url.searchParams.set(key, value);
          const events = await readGooglePages(fetcher, url, value => calendarEventPage.parse(value), signal, budget);
          const seen = new Set<string>();
          for (const event of events) {
            if ("status" in event) continue;
            if (seen.has(event.id)) throw new CalendarReadError();
            seen.add(event.id); merged.push({ ...event, sourceCalendarId: calendarId });
          }
        } catch (error) { if (!failure) { failure = error; stop.abort(); } }
      }
    }));
    if (failure) throw failure;
    signal.throwIfAborted();
    merged.sort((a, b) => eventStart(a)!.getTime() - eventStart(b)!.getTime() || (a.sourceCalendarId ?? "").localeCompare(b.sourceCalendarId ?? "") || a.id.localeCompare(b.id));
    return { ok: true, events: merged };
  } catch (error) {
    return { ok: false, reason: error instanceof CalendarReadError ? error.reason : "error" };
  }
}

export function fetchTodayWindowEvents(context?: ReadContext): Promise<EventsResult> {
  // A 72-hour UTC window includes the browser's today at every UTC offset.
  const now = new Date(), start = new Date(now), end = new Date(now);
  start.setUTCHours(0, 0, 0, 0); start.setUTCDate(start.getUTCDate() - 1);
  end.setUTCHours(0, 0, 0, 0); end.setUTCDate(end.getUTCDate() + 2);
  return fetchWindow(start, end, context);
}

export function fetchUpcomingWeekEvents(context?: ReadContext): Promise<EventsResult> {
  const start = new Date();
  return fetchWindow(start, new Date(start.getTime() + 7 * 86_400_000), context);
}

/** A complete selected-calendar week, or unavailable; partial totals must not
 * become a measured planning record. The browser supplies its DST-aware week. */
export function fetchLastWeekEvents(range: { start: Date; endExclusive: Date }, context?: ReadContext): Promise<EventsResult> {
  return fetchWindow(range.start, range.endExclusive, context);
}
