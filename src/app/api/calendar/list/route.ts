import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchWithGoogleAuth } from "@/lib/google-token";

export type GcalCalendarEntry = {
  id: string;
  summary: string;
  primary?: boolean;
  backgroundColor?: string;
  accessRole?: string;
  selected?: boolean;
};

/**
 * Returns the user's Google calendars (calendarList.list). Lightweight: 1
 * upstream call, response is small JSON. Used by the multi-calendar picker.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const res = await fetchWithGoogleAuth(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?fields=items(id,summary,primary,backgroundColor,accessRole,selected)",
  );

  if (res.status === 401 && res.statusText === "no-token") {
    return NextResponse.json(
      { error: "Google Calendar access has lapsed.", reason: "no-token" },
      { status: 401 },
    );
  }
  if (res.status === 401) {
    return NextResponse.json(
      { error: "Google rejected the calendar token.", reason: "expired" },
      { status: 401 },
    );
  }
  if (!res.ok) {
    return NextResponse.json(
      { error: "Could not fetch calendars." },
      { status: res.status },
    );
  }

  const json = (await res.json()) as { items?: GcalCalendarEntry[] };
  return NextResponse.json({ calendars: json.items ?? [] });
}
