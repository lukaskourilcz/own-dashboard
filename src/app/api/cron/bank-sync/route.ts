import { awaitWithSignal } from "@/lib/abortable";
import { bankSyncSignal } from "@/lib/bank/sync-budget";
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

  const signal = bankSyncSignal(request);
  const admin = createAdminClient(signal);
  try {

    // A consent that has already passed its stated expiry is expired, whatever
    // the last sync thought. Doing this first keeps the pull below honest.
    const expiryQuery = admin
      .from("bank_connections")
      .update({ status: "expired", last_error: "consent-expired" }, { count: "exact" })
      .eq("status", "linked")
      .not("consent_expires_at", "is", null)
      .lt("consent_expires_at", new Date().toISOString())
      .select("id").abortSignal(signal);
    const { count: lapsed, error: expiryError } = await awaitWithSignal(expiryQuery, signal);
    if (expiryError || typeof lapsed !== "number" || !Number.isSafeInteger(lapsed) || lapsed < 0) return NextResponse.json({ error: "Bank expiry check unavailable." }, { status: 500 });

    const query = admin.from("bank_connections").select("*", { count: "exact" })
      .eq("status", "linked").limit(51).abortSignal(signal);
    const { data, count, error } = await awaitWithSignal(query, signal);
    if (error || !Array.isArray(data) || !Number.isSafeInteger(count) || count !== data.length || data.length > 50) {
      return NextResponse.json({ error: "Bank connections unavailable." }, { status: 500 });
    }

    const connections = (data ?? []) as BankConnection[];
    let inserted = 0;
    let banks = 0;
    let failed = 0;
    let skipped = 0;
    for (let index = 0; index < connections.length; index++) {
      if (signal.aborted) { failed += connections.length - index; break; }
      const conn = connections[index];
      try {
        const provider = getProvider(conn.provider, signal);
        if (!(await awaitWithSignal(provider.isConfigured(conn.user_id), signal))) {
          skipped++;
          continue;
        }
        const res = await awaitWithSignal(syncConnection(admin, conn, signal), signal);
        inserted += res.inserted;
        if (res.status === "linked") banks++;
        else failed++;
      } catch {
        failed++;
      }
    }

    // A connection that threw is a real failure signal: the heartbeat stays
    // silent so the monitor can alert, and the run is logged as failed the same
    // way payment matching logs a partial pass.
    if (failed === 0) {
      await pingHeartbeat(heartbeatUrlForJob("bank-sync"));
    }
    await awaitWithSignal(logCronRun({
      name: "Bank sync",
      endpoint: "/api/cron/bank-sync",
      source: "vercel",
      status: failed > 0 ? "failure" : "success",
      detail: `inserted ${inserted}, failed ${failed}, skipped ${skipped}, expired ${lapsed}`,
    }), AbortSignal.timeout(5_000)).catch(() => undefined);
    return NextResponse.json({
      ok: failed === 0,
      banks,
      inserted,
      failed,
      skipped,
      expired: lapsed,
    }, { status: failed > 0 ? 502 : 200 });
  } catch {
    return NextResponse.json({ error: "Bank sync could not be confirmed." }, { status: 502 });
  }
}
