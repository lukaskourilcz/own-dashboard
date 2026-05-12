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
};

export type TodayEventsResult =
  | { ok: true; events: GcalEvent[] }
  | { ok: false; reason: "no-token" | "unauthorized" | "error"; message?: string };

export async function fetchTodayWindowEvents(): Promise<TodayEventsResult> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.provider_token) {
    return { ok: false, reason: "no-token" };
  }

  // Server timezone may not match the user's, so fetch a 72h window centered on
  // server-local today and let the client filter to its own "today".
  const now = new Date();
  const startLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const endLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);

  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
  );
  url.searchParams.set("timeMin", startLocal.toISOString());
  url.searchParams.set("timeMax", endLocal.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "50");

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
