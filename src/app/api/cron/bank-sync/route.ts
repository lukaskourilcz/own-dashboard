import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isGoCardlessConfigured } from "@/lib/gocardless";
import { syncConnection } from "@/lib/bank-sync-server";
import type { BankConnection } from "@/lib/types";

// Bank pulls can take a few seconds per connection; give the function headroom.
export const maxDuration = 60;

/**
 * Runs daily (Vercel Cron) to refresh every linked bank so the user never has
 * to press "Sync now". Idempotent — syncConnection dedupes by external ids, so
 * a re-run inserts only genuinely new transactions.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. No-ops
 * gracefully when GoCardless isn't configured, so the deploy survives before
 * secrets are set.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (expected && auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (!isGoCardlessConfigured()) {
    return NextResponse.json({
      ok: true,
      skipped: "GOCARDLESS secrets not set; no banks synced.",
    });
  }

  const admin = createAdminClient();
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
  for (const conn of connections) {
    try {
      const res = await syncConnection(admin, conn);
      inserted += res.inserted;
      if (res.status === "linked") banks++;
    } catch (err) {
      failed++;
      console.error("[cron/bank-sync] connection failed:", conn.id, err);
    }
  }

  return NextResponse.json({ ok: true, banks, inserted, failed });
}
