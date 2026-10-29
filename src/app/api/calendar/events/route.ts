import { NextRequest, NextResponse } from "next/server";
import { parseLastWeekWindow } from "@/lib/calendar";
import { fetchLastWeekEvents, fetchTodayWindowEvents, fetchUpcomingWeekEvents } from "@/lib/calendar-server";
import { createClient } from "@/lib/supabase/server";
import { awaitWithSignal } from "@/lib/abortable";

export const maxDuration = 30;
const headers = { "cache-control": "private, no-store" };
export async function GET(request: NextRequest) {
  const window = request.nextUrl.searchParams.get("window");
  const range = window === "last-week" ? parseLastWeekWindow(request.nextUrl.searchParams.get("start"), request.nextUrl.searchParams.get("end")) : null;
  if (!["today", "week", "last-week"].includes(window ?? "") || (window === "last-week" && !range)) return NextResponse.json({ error: "Unsupported calendar window." }, { status: 400, headers });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]);
  try {
    const supabase = await awaitWithSignal(createClient(signal), signal);
    const auth = await awaitWithSignal(supabase.auth.getUser(), signal);
    if (auth.error) throw Error("Authentication unavailable");
    if (!auth.data.user) return NextResponse.json({ error: "Not authenticated." }, { status: 401, headers });
    const context = { userId: auth.data.user.id, signal };
    const result = window === "last-week" && range ? await fetchLastWeekEvents(range, context) : window === "today" ? await fetchTodayWindowEvents(context) : await fetchUpcomingWeekEvents(context);
    return NextResponse.json(result, { headers });
  } catch { return NextResponse.json({ ok: false, reason: "error" }, { status: 503, headers }); }
}
