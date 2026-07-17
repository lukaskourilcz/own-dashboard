import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getAccountBalances,
  getAccountDetails,
  getAccountTransactions,
  getRequisition,
  mapTransaction,
  type Balance,
} from "@/lib/gocardless";
import { categorizeNote, type Rule } from "@/lib/category-rules";
import type { BankConnection } from "@/lib/types";

/** GoCardless requisition status codes → our connection status. */
function mapStatus(code: string): BankConnection["status"] {
  if (code === "LN") return "linked";
  if (code === "EX" || code === "SU") return "expired";
  if (code === "CR" || code === "GC" || code === "UA" || code === "GA" || code === "SA")
    return "created";
  return "error";
}

/** Pick the most "current balance"-like figure from a GoCardless balances list. */
function pickBalance(balances: Balance[]): { amount: number; currency: string } | null {
  if (!balances?.length) return null;
  const order = ["closingBooked", "interimBooked", "interimAvailable", "expected"];
  const chosen =
    order
      .map((t) => balances.find((b) => b.balanceType === t))
      .find(Boolean) ?? balances[0];
  const amount = Number(chosen.balanceAmount.amount);
  if (!Number.isFinite(amount)) return null;
  return { amount, currency: chosen.balanceAmount.currency };
}

export type SyncResult = {
  inserted: number;
  accountsLinked: number;
  status: BankConnection["status"];
};

/**
 * Pull balances + transactions for one linked bank connection and fold them
 * into the accounts / transactions tables. Idempotent: accounts are keyed by
 * external_ref (the GoCardless account id) and transactions by external_id, so
 * re-syncing only ever inserts genuinely new rows.
 *
 * `admin` must be the service-role client — it writes rows for the user and
 * updates the connection's status/last_synced_at.
 */
export async function syncConnection(
  admin: SupabaseClient,
  conn: BankConnection,
): Promise<SyncResult> {
  const req = await getRequisition(conn.requisition_id);
  const status = mapStatus(req.status);

  if (status !== "linked") {
    await admin
      .from("bank_connections")
      .update({ status })
      .eq("id", conn.id);
    return { inserted: 0, accountsLinked: 0, status };
  }

  // Existing dedupe key set for this user — cheap at personal scale.
  const { data: existingRows } = await admin
    .from("transactions")
    .select("external_id")
    .eq("user_id", conn.user_id)
    .not("external_id", "is", null);
  const seen = new Set<string>(
    (existingRows ?? []).map((r: { external_id: string }) => r.external_id),
  );

  // Auto-category rules — applied to each new transaction's note.
  const { data: ruleRows } = await admin
    .from("transaction_category_rules")
    .select("match, category")
    .eq("user_id", conn.user_id)
    .order("created_at", { ascending: true });
  const rules = (ruleRows ?? []) as Rule[];

  let inserted = 0;
  let accountsLinked = 0;

  for (const gcAccountId of req.accounts ?? []) {
    accountsLinked++;

    // Resolve (or create) our local account row for this bank account.
    const details = await getAccountDetails(gcAccountId).catch(() => null);
    const balances = await getAccountBalances(gcAccountId).catch(() => null);
    const bal = balances ? pickBalance(balances.balances) : null;
    const currency =
      bal?.currency ?? details?.account?.currency ?? "EUR";
    const name =
      details?.account?.name ??
      details?.account?.product ??
      conn.institution_name ??
      "Bank account";

    const { data: acct } = await admin
      .from("accounts")
      .select("id")
      .eq("user_id", conn.user_id)
      .eq("external_ref", gcAccountId)
      .maybeSingle();

    let accountId: string | null = acct?.id ?? null;
    if (accountId) {
      await admin
        .from("accounts")
        .update({
          balance: bal?.amount ?? 0,
          currency,
          updated_at: new Date().toISOString(),
        })
        .eq("id", accountId);
    } else {
      const { data: created } = await admin
        .from("accounts")
        .insert({
          user_id: conn.user_id,
          name,
          balance: bal?.amount ?? 0,
          currency,
          external_ref: gcAccountId,
        })
        .select("id")
        .single();
      accountId = created?.id ?? null;
    }

    // Pull transactions and insert only the ones we haven't seen before.
    const txRes = await getAccountTransactions(gcAccountId).catch(() => null);
    const booked = txRes?.transactions?.booked ?? [];
    const rows = booked
      .map((tx) => mapTransaction(tx, conn.user_id, accountId))
      .filter((r): r is NonNullable<typeof r> => r !== null && !!r.occurred_on)
      .filter((r) => !seen.has(r.external_id))
      .map((r) => ({ ...r, category: categorizeNote(r.note, rules) }));

    // Guard against duplicates within this batch too.
    const batch: typeof rows = [];
    for (const r of rows) {
      if (seen.has(r.external_id)) continue;
      seen.add(r.external_id);
      batch.push(r);
    }

    if (batch.length) {
      const { error } = await admin.from("transactions").insert(batch);
      if (!error) inserted += batch.length;
    }
  }

  await admin
    .from("bank_connections")
    .update({ status: "linked", last_synced_at: new Date().toISOString() })
    .eq("id", conn.id);

  return { inserted, accountsLinked, status: "linked" };
}
