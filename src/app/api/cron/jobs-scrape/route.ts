import { NextResponse } from "next/server";
import { rejectUnlessCron } from "@/lib/cron-auth";
import { logCronRun } from "@/lib/cron-log";
import { heartbeatUrlForJob, pingHeartbeat } from "@/lib/heartbeat";
import { createAdminClient } from "@/lib/supabase/admin";
import { runJobScrape } from "@/lib/jobs/scrape";

/**
 * Manual, authenticated job-board scrape. No schedule has called it since #81
 * made Career load on demand; Career's "Check for new offers" button uses
 * /api/jobs/refresh. Pulls remote-friendly European frontend, fullstack and
 * software-engineering openings from every configured source into
 * `job_listings`.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}`, like every /api/cron route.
 * Every other call gets 403, and so does every call while CRON_SECRET is
 * unset.
 *
 * No-ops gracefully when the service-role key is missing so a fresh deploy
 * without env vars still boots.
 */

// Several boards are fetched (with a 12s per-source timeout); allow the
// function more than the default runtime budget.
export const maxDuration = 60;

export async function GET(request: Request) {
  const rejected = rejectUnlessCron(request);
  if (rejected) return rejected;

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
  // Only a clean pass pings; a failed scrape lets the monitor notice.
  if (summary.ok) await pingHeartbeat(heartbeatUrlForJob("jobs-scrape"));
  await logCronRun({
    name: "Jobs scrape",
    endpoint: "/api/cron/jobs-scrape",
    source: "vercel",
    status: summary.ok ? "success" : "failure",
  });
  return NextResponse.json(summary, { status: summary.ok ? 200 : 500 });
}
