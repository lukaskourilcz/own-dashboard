import { NextRequest, NextResponse } from "next/server";
import { parseLastWeekWindow } from "@/lib/calendar";
import {
  fetchLastWeekEvents,
  fetchTodayWindowEvents,
  fetchUpcomingWeekEvents,
} from "@/lib/calendar-server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const window = request.nextUrl.searchParams.get("window");
  if (window !== "today" && window !== "week" && window !== "last-week") {
    return NextResponse.json({ error: "Unsupported calendar window." }, { status: 400 });
  }

  if (window === "last-week") {
    // Last week is the browser's week: it sends the two instants.
    const range = parseLastWeekWindow(
      request.nextUrl.searchParams.get("start"),
      request.nextUrl.searchParams.get("end"),
    );
    if (!range) {
      return NextResponse.json({ error: "Unsupported calendar window." }, { status: 400 });
    }
    return NextResponse.json(await fetchLastWeekEvents(range));
  }

  const result = window === "today"
    ? await fetchTodayWindowEvents()
    : await fetchUpcomingWeekEvents();
  return NextResponse.json(result);
}
