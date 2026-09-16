import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectCrossOrigin } from "@/lib/csrf";
import { configuredProviders } from "@/lib/bank/registry";
import { syncConnection, syncConnectionById } from "@/lib/bank-sync-server";
import type { BankConnection } from "@/lib/types";

/**
 * Pull the latest balances + transactions. With `{ connectionId }` in the body
 * it syncs that one connection — the per-connection trigger beside each bank —
 * and without a body it syncs every connection the owner has. Idempotent
 * (dedupes by external ids), so it can be pressed as often as you like.
 *
 * The availability gate asks the provider registry, not GoCardless: an install
 * with only a Fio token configured must not be told bank sync is unavailable.
 */
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

  // An empty body is the "sync everything" case and must stay valid.
  let connectionId: string | null = null;
  try {
    const body = (await request.json()) as { connectionId?: string } | null;
    connectionId = body?.connectionId?.trim() || null;
  } catch {
    connectionId = null;
  }

  const providers = await configuredProviders(user.id);
  if (providers.length === 0) {
    return NextResponse.json({ error: "not-configured" }, { status: 503 });
  }

  const admin = createAdminClient();

  if (connectionId) {
    try {
      const result = await syncConnectionById(admin, user.id, connectionId);
      if (!result) {
        return NextResponse.json({ error: "Not found." }, { status: 404 });
      }
      return NextResponse.json({
        inserted: result.inserted,
        banks: result.status === "linked" ? 1 : 0,
        accounts: result.accountsLinked,
      });
    } catch (err) {
      console.error("[api/bank/sync] connection failed:", connectionId, err);
      return NextResponse.json({ error: "Sync failed." }, { status: 502 });
    }
  }

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
