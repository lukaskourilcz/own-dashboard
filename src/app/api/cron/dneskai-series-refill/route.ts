import { NextResponse } from "next/server";
import { rejectUnlessCron } from "@/lib/cron-auth";
import { logCronRun } from "@/lib/cron-log";
import { runDneskaiSeriesRefill } from "@/lib/marketing/dneskai-series-refill-run";
import { resolveDneskaiProjectId } from "@/lib/marketing/scheduler-ports";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * The DNESKAi series refill (owner decision, 8 November 2026). Vercel Cron calls it daily; it does nothing paid
 * while every series has two weeks of approved posts, and the wave ledger lets a wave start at most once every
 * twelve days, so a wave runs about once every two weeks. Auth: `Authorization: Bearer ${CRON_SECRET}`.
 * The answer carries counts, codes and costs only. docs/dneskai-series.md describes the wave.
 */
export async function GET(request: Request) {
  const rejected = rejectUnlessCron(request);
  if (rejected) return rejected;
  const owner = process.env.MARKETING_OWNER_ID;
  if (!owner) return NextResponse.json({ error: "series-owner-unconfigured" }, { status: 503 });
  const db = createAdminClient();
  try {
    const project = await resolveDneskaiProjectId(db, owner);
    const result = await runDneskaiSeriesRefill({ db, owner, project, signal: request.signal });
    console.info(JSON.stringify({ event: "dneskai-series-refill", ...result }));
    await logCronRun({ name: "DNESKAi series refill", endpoint: "/api/cron/dneskai-series-refill", source: "vercel", status: "success" });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error && /^[a-z][a-z0-9-]{1,79}$/.test(error.message) ? error.message : "series-refill-failed";
    console.warn(JSON.stringify({ event: "dneskai-series-refill-failed", code }));
    await logCronRun({ name: "DNESKAi series refill", endpoint: "/api/cron/dneskai-series-refill", source: "vercel", status: "failure" });
    return NextResponse.json({ error: code }, { status: 500 });
  }
}
