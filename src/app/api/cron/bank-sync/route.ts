import { NextResponse } from "next/server";
import { rejectUnlessCron } from "@/lib/cron-auth";
import { logCronRun } from "@/lib/cron-log";
import { heartbeatUrlForJob, pingHeartbeat } from "@/lib/heartbeat";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProvider } from "@/lib/bank/registry";
import { syncConnection } from "@/lib/bank-sync-server";
import type { BankConnection } from "@/lib/types";

// Bank pulls can take a few seconds per connection; give the function headroom.
export const maxDuration = 60;

/**
 * Runs daily (Vercel Cron) to refresh every linked bank so the user never has
 * to press "Sync now". Idempotent — syncConnection dedupes by external ids, so
 * a re-run inserts only genuinely new transactions.
 *
 * Two things changed with the provider abstraction. A connection whose consent
 * has already lapsed is marked `expired` before anything is pulled, so a PSD2
 * 90-day lapse is visible the morning it happens instead of surfacing as a
 * failed sync days later. And availability is decided per connection by its own
 * provider, so an install with no GoCardless credentials still syncs Fio.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`; every
 * other call gets 403, and so does every call while CRON_SECRET is unset. A
 * connection whose provider has no credentials is skipped, so the job is
 * harmless before those secrets exist.
 */
export async function GET(request: Request) {
  const rejected = rejectUnlessCron(request);
  if (rejected) return rejected;

  const admin = createAdminClient();

  // A consent that has already passed its stated expiry is expired, whatever
  // the last sync thought. Doing this first keeps the pull below honest.
  const { data: lapsedRows } = await admin
    .from("bank_connections")
    .update({ status: "expired", last_error: "consent-expired" })
    .eq("status", "linked")
    .not("consent_expires_at", "is", null)
    .lt("consent_expires_at", new Date().toISOString())
    .select("id");
  const lapsed = (lapsedRows ?? []).length;

  const { data, error } = await admin
    .from("bank_connections")
    .select("*")
    .eq("status", "linked");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const connections = (data ?? []) as BankConnection[];
  let inserted = 0;
  let banks = 0;
  let failed = 0;
  let skipped = 0;
  for (const conn of connections) {
    try {
      const provider = getProvider(conn.provider);
      if (!(await provider.isConfigured(conn.user_id))) {
        skipped++;
        continue;
      }
      const res = await syncConnection(admin, conn);
      inserted += res.inserted;
      if (res.status === "linked") banks++;
    } catch (err) {
      failed++;
      console.error("[cron/bank-sync] connection failed:", conn.id, err);
    }
  }

  // A connection that threw is a real failure signal: the heartbeat stays
  // silent so the monitor can alert, and the run is logged as failed the same
  // way payment matching logs a partial pass.
  if (failed === 0) {
    await pingHeartbeat(heartbeatUrlForJob("bank-sync"));
  }
  await logCronRun({
    name: "Bank sync",
    endpoint: "/api/cron/bank-sync",
    source: "vercel",
    status: failed > 0 ? "failure" : "success",
    detail: `inserted ${inserted}, failed ${failed}, skipped ${skipped}, expired ${lapsed}`,
  });
  return NextResponse.json({
    ok: true,
    banks,
    inserted,
    failed,
    skipped,
    expired: lapsed,
  });
}
