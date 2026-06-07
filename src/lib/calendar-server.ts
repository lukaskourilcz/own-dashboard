import "server-only";
import { fetchWithGoogleAuth } from "@/lib/google-token";
import { createClient as createUserClient } from "@/lib/supabase/server";
import { loadUserPreferences } from "@/lib/user-prefs";
import type { EventsResult, GcalEvent } from "@/lib/calendar";

type RawEvent = GcalEvent & { _calendarId?: string };

async function fetchOne(
  calendarId: string,
  timeMin: Date,
  timeMax: Date,
  maxResults: number,
): Promise<{
  ok: boolean;
  status?: number;
  reason?: "no-token" | "unauthorized" | "error";
  events?: RawEvent[];
  message?: string;
}> {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId,
    )}/events`,
  );
  url.searchParams.set("timeMin", timeMin.toISOString());
  url.searchParams.set("timeMax", timeMax.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", String(maxResults));

  try {
    const res = await fetchWithGoogleAuth(url.toString());

    if (res.status === 401 && res.statusText === "no-token") {
      return { ok: false, status: 401, reason: "no-token" };
    }
    if (res.status === 401) {
      return { ok: false, status: 401, reason: "unauthorized" };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        reason: "error",
        message: `Calendar API ${res.status}`,
      };
    }
    const json = (await res.json()) as { items?: GcalEvent[] };
    const tagged: RawEvent[] = (json.items ?? []).map((e) => ({
      ...e,
      _calendarId: calendarId,
    }));
    return { ok: true, events: tagged };
  } catch (err) {
    return { ok: false, reason: "error", message: (err as Error).message };
  }
}

async function fetchWindow(
  timeMin: Date,
  timeMax: Date,
  maxResults: number,
): Promise<EventsResult> {
  const supabase = await createUserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "no-token" };

  const prefs = await loadUserPreferences(user.id);
  const calendarIds =
    prefs.selected_calendar_ids.length > 0
      ? prefs.selected_calendar_ids
      : ["primary"];

  const results = await Promise.all(
    calendarIds.map((id) => fetchOne(id, timeMin, timeMax, maxResults)),
  );

  // If every single fetch failed with no-token / unauthorized, surface that
  // single reason to the UI. If at least one calendar returned events, render
  // those and silently drop the rest (a broken secondary calendar shouldn't
  // hide the working primary one).
  const successes = results.filter((r) => r.ok);
  if (successes.length === 0) {
    const first = results[0];
    return {
      ok: false,
      reason: first?.reason ?? "error",
      message: first?.message,
    };
  }

  const merged = successes.flatMap((r) => r.events ?? []);
  merged.sort((a, b) => {
    const at =
      a.start.dateTime ?? `${a.start.date ?? ""}T00:00:00`;
    const bt =
      b.start.dateTime ?? `${b.start.date ?? ""}T00:00:00`;
    return at.localeCompare(bt);
  });

  return { ok: true, events: merged };
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
