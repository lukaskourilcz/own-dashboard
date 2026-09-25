import { NextResponse } from "next/server";
import { logCronRun } from "@/lib/cron-log";
import { heartbeatUrlForJob, pingHeartbeat } from "@/lib/heartbeat";
import { createAdminClient } from "@/lib/supabase/admin";
import { runPaymentMatching } from "@/lib/payment-matching-server";

// A matching pass is a handful of bounded queries plus one update per link;
// the headroom is for an owner with a long backlog of open invoices.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Pairs incoming bank payments with issued invoices on a schedule, so a paid
 * invoice stops asking to be marked paid by hand.
 *
 * Deterministic: variable symbol plus amount inside the invoice's own rounding
 * tolerance. No model is involved, and a payment that does not satisfy every
 * rule is left alone for the owner to link from the unmatched-payments card.
 *
 * Idempotent — a linked payment carries `invoice_id`, so a re-run does not see
 * it again and cannot pay the same invoice twice.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. Owners are
 * every user who currently has an issued bank invoice, so the job costs nothing
 * for an account with an empty receivables list.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (expected && auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    // Keeps the deploy alive before the service-role key is set.
    return NextResponse.json({
      ok: true,
      skipped: "SUPABASE_SERVICE_ROLE_KEY not set; no payments matched.",
    });
  }

  const { data, error } = await admin
    .from("invoices")
    .select("user_id")
    .eq("status", "issued")
    .eq("payment_method", "bank");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const owners = [...new Set((data ?? []).map((row) => row.user_id as string))];
  let scanned = 0;
  let linked = 0;
  let unmatched = 0;
  let failed = 0;

  for (const owner of owners) {
    try {
      const result = await runPaymentMatching(admin, owner);
      scanned += result.scanned;
      linked += result.linked;
      unmatched += result.unmatched.length;
    } catch (err) {
      failed++;
      console.error("[cron/payment-match] owner failed:", owner, err);
    }
  }

  // Only a pass where every owner completed pings the monitor.
  if (failed === 0) await pingHeartbeat(heartbeatUrlForJob("payment-match"));
  await logCronRun({
    name: "Payment matching",
    endpoint: "/api/cron/payment-match",
    source: "vercel",
    status: failed > 0 ? "failure" : "success",
    detail: `scanned ${scanned}, linked ${linked}, unmatched ${unmatched}, failed ${failed}`,
  });
  return NextResponse.json({ ok: true, owners: owners.length, scanned, linked, unmatched, failed });
}
