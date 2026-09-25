import { NextRequest, NextResponse } from "next/server";
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

  const result = window === "today"
    ? await fetchTodayWindowEvents()
    : window === "week"
      ? await fetchUpcomingWeekEvents()
      : await fetchLastWeekEvents();
  return NextResponse.json(result);
}
