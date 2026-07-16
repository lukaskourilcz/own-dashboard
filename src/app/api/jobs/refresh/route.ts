import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectCrossOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import { runJobScrape } from "@/lib/jobs/scrape";

/**
 * Manual "Check now" from the Jobs panel — the same scrape the daily cron
 * runs, on demand. Signed-in users only, rate-limited hard (the scrape
 * fans out to ~50 upstream requests, and the boards don't change faster
 * than a few times a day anyway).
 */

export const maxDuration = 60;

export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const rl = await rateLimit(user.id, {
    key: "jobs-refresh",
    limit: 2,
    windowSec: 600,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many refreshes.", retryAfter: rl.retryAfter },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfter) },
      },
    );
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Server is missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 501 },
    );
  }

  const summary = await runJobScrape(admin);
  return NextResponse.json(summary, { status: summary.ok ? 200 : 500 });
}
