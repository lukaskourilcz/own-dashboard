import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runJobScrape } from "@/lib/jobs/scrape";

/**
 * Daily job-board scrape (Vercel Cron, 08:00 UTC = 10:00 Prague in summer /
 * 09:00 in winter — the requested "10 AM UTC+2" slot). Pulls remote-friendly
 * European frontend/fullstack/software-engineering openings from every
 * configured source into `job_listings` for the Jobs section.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`; reject
 * anything else once the secret is configured (mirrors renewal-warnings).
 *
 * No-ops gracefully when the service-role key is missing so a fresh deploy
 * without env vars still boots.
 */

// Several boards are fetched (with a 12s per-source timeout); allow the
// function more than the default runtime budget.
export const maxDuration = 60;

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (expected && auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({
      ok: true,
      skipped: "SUPABASE_SERVICE_ROLE_KEY not set; scrape skipped.",
    });
  }

  const summary = await runJobScrape(admin);
  return NextResponse.json(summary, { status: summary.ok ? 200 : 500 });
}
