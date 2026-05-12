import { createClient } from "@/lib/supabase/server";

export type GcalEventTime = {
  dateTime?: string;
  date?: string;
  timeZone?: string;
};

export type GcalEvent = {
  id: string;
  summary?: string;
  start: GcalEventTime;
  end: GcalEventTime;
  htmlLink?: string;
  location?: string;
  recurrence?: string[];
  recurringEventId?: string;
};

export type EventsResult =
  | { ok: true; events: GcalEvent[] }
  | { ok: false; reason: "no-token" | "unauthorized" | "error"; message?: string };

// Kept as a re-export so callers that imported the original name still compile.
export type TodayEventsResult = EventsResult;

async function fetchWindow(
  timeMin: Date,
  timeMax: Date,
  maxResults: number,
): Promise<EventsResult> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.provider_token) return { ok: false, reason: "no-token" };

  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
  );
  url.searchParams.set("timeMin", timeMin.toISOString());
  url.searchParams.set("timeMax", timeMax.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", String(maxResults));

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${session.provider_token}` },
      cache: "no-store",
    });
    if (res.status === 401) return { ok: false, reason: "unauthorized" };
    if (!res.ok) {
      return { ok: false, reason: "error", message: `Calendar API ${res.status}` };
    }
    const json = (await res.json()) as { items?: GcalEvent[] };
    return { ok: true, events: json.items ?? [] };
  } catch (err) {
    return { ok: false, reason: "error", message: (err as Error).message };
  }
}

export async function fetchTodayWindowEvents(): Promise<EventsResult> {
  // Server timezone may not match the user's, so fetch a 72h window centered on
  // server-local today and let the client filter to its own "today".
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
  return fetchWindow(start, end, 50);
}

export async function fetchUpcomingWeekEvents(): Promise<EventsResult> {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + 7);
  return fetchWindow(now, end, 100);
}
