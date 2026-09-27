import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchWithGitHubAuth } from "@/lib/github-token";
import { readMarketingCalendars } from "@/lib/marketing-calendars-server";
import { rateLimit } from "@/lib/rate-limit";

/**
 * The marketing calendars IG TIPS and the Work overview read.
 *
 * GET /api/marketing/calendars → MarketingCalendarsResponse. Each configured
 * `marketing-calendar/1` document (`MARKETING_CALENDAR_SOURCES`) is read from
 * its repository through the owner's GitHub token on every call and never
 * stored; the browser keeps the answer for the page session and asks again
 * only when the owner presses "Check the calendars again". The response
 * carries trimmed entries (date, platform, kind, title, status, tip titles)
 * and a status per calendar; the token never leaves the server.
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

  const result = await readMarketingCalendars(fetchWithGitHubAuth);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
