import { NextResponse } from "next/server";
import { awaitWithSignal } from "@/lib/abortable";
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

// The complete on-demand pass has its own bounded lifetime.
export const maxDuration = 60;

export async function GET(request: Request) {
  const rejected = rejectUnlessCron(request);
  if (rejected) return rejected;

  const lifetime = new AbortController();
  const signal = AbortSignal.any([request.signal, lifetime.signal, AbortSignal.timeout(55_000)]);
  const headers = { "Cache-Control": "private, no-store" };
  try {
    signal.throwIfAborted();
    let admin;
    try { admin = createAdminClient(signal); }
    catch { return NextResponse.json({ ok: true, skipped: "SUPABASE_SERVICE_ROLE_KEY not set; scrape skipped." }, { headers }); }
    const summary = await awaitWithSignal(runJobScrape(admin, { signal }), signal);
    signal.throwIfAborted();
    const logged = await awaitWithSignal(logCronRun({ name: "Jobs scrape", endpoint: "/api/cron/jobs-scrape", source: "vercel", status: summary.ok ? "success" : "failure" }, signal), signal);
    signal.throwIfAborted();
    if (!logged.recorded) throw new Error("jobs-scrape-unavailable");
    // A healthy ping follows a confirmed source pass and recorded run. The
    // existing environment heartbeat remains distinct from an owned monitor.
    if (summary.ok) await awaitWithSignal(pingHeartbeat(heartbeatUrlForJob("jobs-scrape"), signal), signal);
    signal.throwIfAborted();
    return NextResponse.json(summary, { status: summary.ok ? 200 : 500, headers });
  } catch { return NextResponse.json({ ok: false, error: "jobs-scrape-unavailable" }, { status: 503, headers }); }
  finally { lifetime.abort(); }
}
