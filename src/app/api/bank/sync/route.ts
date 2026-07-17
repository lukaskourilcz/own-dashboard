import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectCrossOrigin } from "@/lib/csrf";
import { isGoCardlessConfigured } from "@/lib/gocardless";
import { syncConnection } from "@/lib/bank-sync-server";
import type { BankConnection } from "@/lib/types";

/**
 * Pull the latest balances + transactions for every linked bank and fold them
 * into accounts / transactions. Idempotent (dedupes by external ids), so the
 * user can hit "Sync now" as often as they like.
 */
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;

  if (!isGoCardlessConfigured()) {
    return NextResponse.json({ error: "not-configured" }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: conns } = await admin
    .from("bank_connections")
    .select("*")
    .eq("user_id", user.id);

  const connections = (conns ?? []) as BankConnection[];
  if (connections.length === 0) {
    return NextResponse.json({ inserted: 0, banks: 0, accounts: 0 });
  }

  let inserted = 0;
  let accounts = 0;
  let banks = 0;
  for (const conn of connections) {
    try {
      const res = await syncConnection(admin, conn);
      inserted += res.inserted;
      accounts += res.accountsLinked;
      if (res.status === "linked") banks++;
    } catch (err) {
      console.error("[api/bank/sync] connection failed:", conn.id, err);
    }
  }

  return NextResponse.json({ inserted, banks, accounts });
}
