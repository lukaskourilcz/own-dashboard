import { NextResponse } from "next/server";
import { readVerifiedServerOwner } from "@/lib/supabase/server-owner";
import { awaitWithSignal } from "@/lib/abortable";
import { createGitHubFetcher } from "@/lib/github-token";
import { readMarketingCalendars } from "@/lib/marketing-calendars-server";
import { rateLimit } from "@/lib/rate-limit";

/**
 * The marketing calendars IG TIPS and the Work overview read.
 *
 * GET /api/marketing/calendars → MarketingCalendarsResponse. Each configured
 * `marketing-calendar/1` document (`MARKETING_CALENDAR_SOURCES`) is read from
 * its repository through the owner's GitHub token on every call and never
 * stored on the server. The shared browser query is fresh for thirty minutes;
 * a stale remount or explicit check refreshes it, while focus does not. The response
 * carries trimmed entries (date, platform, kind, title, status, tip titles)
 * and a status per calendar; the token never leaves the server.
 */
export const maxDuration = 30;

export async function GET(request: Request) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const ownerId = await readVerifiedServerOwner(signal);
    if (!ownerId) return NextResponse.json({ error: "Not authenticated." }, { status: 401, headers });
    signal.throwIfAborted();
    const rateSignal = AbortSignal.any([signal, AbortSignal.timeout(3_000)]);
    const limited = await awaitWithSignal(rateLimit(ownerId, { key: "marketing-calendars", limit: 10, windowSec: 60 }), rateSignal);
    signal.throwIfAborted();
    if (!limited.ok) {
      return NextResponse.json(
        { error: "Too many requests." },
        { status: 429, headers: { ...headers, "Retry-After": String(limited.retryAfter) } },
      );
    }
    const fetchWithGitHubAuth = createGitHubFetcher(ownerId, signal);
    const result = await awaitWithSignal(readMarketingCalendars(fetchWithGitHubAuth, undefined, undefined, signal), signal);
    signal.throwIfAborted();
    return NextResponse.json(result, { headers });
  } catch {
    return NextResponse.json({ error: "Calendars unavailable." }, { status: 503, headers });
  }
}
