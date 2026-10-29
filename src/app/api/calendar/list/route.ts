import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createGoogleFetcher } from "@/lib/google-token";
import { awaitWithSignal } from "@/lib/abortable";
import { CalendarReadError, readGooglePages } from "@/lib/calendar-google-read";
import { calendarListPage } from "@/lib/calendar-response";
export type { GcalCalendarEntry } from "@/lib/calendar-response";

export const maxDuration = 30;
const headers = { "cache-control": "private, no-store" };
export async function GET(request: Request) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]);
  try {
    const supabase = await awaitWithSignal(createClient(signal), signal);
    const auth = await awaitWithSignal(supabase.auth.getUser(), signal);
    if (auth.error) throw new CalendarReadError();
    if (!auth.data.user) return NextResponse.json({ error: "Not authenticated." }, { status: 401, headers });
    const url = new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList");
    url.searchParams.set("fields", "nextPageToken,items(id,summary,primary,backgroundColor,accessRole,selected)");
    url.searchParams.set("maxResults", "250");
    const calendars = await readGooglePages(createGoogleFetcher(auth.data.user.id, signal), url, value => calendarListPage.parse(value), signal, { pages: 4, items: 500, characters: 2_097_152 });
    if (new Set(calendars.map(calendar => calendar.id)).size !== calendars.length || calendars.filter(calendar => calendar.primary).length > 1) throw new CalendarReadError();
    return NextResponse.json({ calendars }, { headers });
  } catch (error) {
    const reason = error instanceof CalendarReadError ? error.reason : "error";
    return NextResponse.json({ error: "Could not load calendars.", ...(reason === "no-token" || reason === "unauthorized" ? { reason: reason === "no-token" ? "no-token" : "expired" } : {}) }, { status: reason === "error" ? 503 : 401, headers });
  }
}
