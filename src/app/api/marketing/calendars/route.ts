import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readMarketingCalendars } from "@/lib/marketing-calendars-server";
import { readPlanCalendarEntries } from "@/lib/marketing-calendars-plan";
import { pragueMarketingDate } from "@/lib/marketing/weekly-planning";
import { rateLimit } from "@/lib/rate-limit";

/**
 * The marketing calendars IG TIPS and the Work overview read.
 *
 * GET /api/marketing/calendars → MarketingCalendarsResponse. Each configured
 * `marketing-calendar/1` document (`MARKETING_CALENDAR_SOURCES`) is read from
 * the archived files on disk, and the next 30 days come from the owner's plan
 * tables (`marketing_dneskai_plan`, `marketing_devshark_plan`). Nothing is
 * stored; the browser keeps
 * the answer for the page session and asks again only when the owner presses
 * "Check the calendars again". The response carries trimmed entries (date,
 * platform, kind, title, status, tip titles) and a status per calendar.
 */
export const maxDuration = 30;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const limited = await rateLimit(user.id, { key: "marketing-calendars", limit: 10, windowSec: 60 });
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const now = new Date();
  const today = pragueMarketingDate(now);
  // The plan is read through the owner's session; a failed read leaves that project on its archive.
  const entries = await readPlanCalendarEntries(supabase, user.id, today).catch(() => ({}));
  const result = await readMarketingCalendars(undefined, now.toISOString(), { entries, today });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
