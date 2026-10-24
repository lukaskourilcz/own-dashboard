import { awaitWithSignal } from "@/lib/abortable";
import { readTextPrefix } from "@/lib/bounded-text";
import type { EventsResult } from "@/lib/calendar";
import type { GcalCalendarEntry } from "@/lib/calendar-response";

async function readCalendarJson(url: string, parent?: AbortSignal) {
  const signal = AbortSignal.any([AbortSignal.timeout(25_000), ...(parent ? [parent] : [])]);
  const response = await awaitWithSignal(fetch(url, { cache: "no-store", signal }), signal);
  if (!response.ok) { if (response.body) void response.body.cancel().catch(() => undefined); throw Error("Calendar unavailable"); }
  const prefix = await awaitWithSignal(readTextPrefix(response, 8_388_608, signal), signal);
  if (prefix.truncated) throw Error("Calendar unavailable");
  return JSON.parse(prefix.text) as unknown;
}

export async function fetchCalendarList({ signal }: { signal: AbortSignal }): Promise<GcalCalendarEntry[]> {
  const budget = AbortSignal.any([signal, AbortSignal.timeout(25_000)]);
  const [body, { calendarListResponse }] = await awaitWithSignal(Promise.all([readCalendarJson("/api/calendar/list", budget), import("@/lib/calendar-response")]), budget);
  const { calendars } = calendarListResponse.parse(body);
  if (new Set(calendars.map(calendar => calendar.id)).size !== calendars.length || calendars.filter(calendar => calendar.primary).length > 1) throw Error("Calendar unavailable");
  return calendars;
}

export async function fetchCalendarEvents(query: URLSearchParams, signal?: AbortSignal): Promise<EventsResult> {
  const budget = AbortSignal.any([AbortSignal.timeout(25_000), ...(signal ? [signal] : [])]);
  const [body, { calendarEventsResponse }] = await awaitWithSignal(Promise.all([readCalendarJson(`/api/calendar/events?${query}`, budget), import("@/lib/calendar-response")]), budget);
  return calendarEventsResponse.parse(body);
}
