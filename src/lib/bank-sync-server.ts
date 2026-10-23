import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getProvider } from "@/lib/bank/registry";
import { bindTransaction, type ProviderConsent } from "@/lib/bank/provider";
import {
  createRuleEvaluator,
  usableRules,
} from "@/lib/transaction-rules";
import { readTransactionRuleContext } from "@/lib/transaction-rule-data";
import { importTransactionBatch } from "@/lib/transaction-import";
import { SUPPORTED_CURRENCIES } from "@/lib/fx";
import type { BankConnection } from "@/lib/types";

export type SyncResult = {
  inserted: number;
  accountsLinked: number;
  status: BankConnection["status"];
};

/**
 * A provider outage is not a lapsed consent. `expired` and `created` are states
 * the bank itself reports and are persisted, because they need the owner to act.
 * `error` on a connection that was linked is recorded as `last_error` only: a
 * timeout must not drop the row out of the cron's `status = 'linked'` pool and
 * turn a bad minute into a permanent stop.
 */
function nextStatus(
  previous: BankConnection["status"],
  consent: ProviderConsent,
): BankConnection["status"] {
  if (consent.status === "error" && previous === "linked") return "linked";
  return consent.status;
}

type FailureCode = "bank-sync-failed" | "bank-write-unconfirmed" | "bank-balance-unavailable" | "bank-data-unavailable" | "bank-rules-unavailable";
class BankSyncFailure extends Error {
  constructor(readonly code: FailureCode) { super(code); }
}

async function writeConnection(admin: SupabaseClient, conn: BankConnection, patch: Record<string, unknown>) {
  const { data, error } = await admin.from("bank_connections").update(patch)
    .eq("id", conn.id).eq("user_id", conn.user_id).select("id").single();
  if (error || data?.id !== conn.id) throw new BankSyncFailure("bank-write-unconfirmed");
}

/**
 * Pull balances + transactions for one bank connection and fold them into the
 * accounts / transactions tables. Idempotent: accounts are keyed by
 * external_ref and transactions by external_id, so re-syncing only ever inserts
 * genuinely new rows.
 *
 * Provider-neutral since issue #64 — everything bank-specific lives behind the
 * adapter resolved from `conn.provider`, and an unregistered provider throws
 * rather than being treated as GoCardless.
 *
 * `admin` must be the service-role client — it writes rows for the user and
 * updates the connection's status/last_synced_at.
 */
export async function syncConnection(admin: SupabaseClient, conn: BankConnection): Promise<SyncResult> {
  const startedAt = new Date();
  try {
    const provider = getProvider(conn.provider);
    const consent = await provider.getConsent(conn);
    if (consent.status !== "linked") {
      await writeConnection(admin, conn, {
        status: nextStatus(conn.status, consent), consent_expires_at: consent.expiresAt,
        last_error: consent.status === "error" ? "bank-sync-failed" : consent.status === "expired" ? "consent-expired" : null,
      });
      // The persisted status keeps a transient outage eligible for cron retry;
      // the returned status must still report that this pull failed.
      return { inserted: 0, accountsLinked: 0, status: consent.status };
    }
    const result = await pullConnection(admin, conn, provider);
    await writeConnection(admin, conn, {
      status: "linked", consent_expires_at: consent.expiresAt, last_error: null,
      sync_cursor: startedAt.toISOString().slice(0, 10), last_synced_at: new Date().toISOString(),
    });
    return result;
  } catch (error) {
    const code = error instanceof BankSyncFailure ? error.code : "bank-sync-failed";
    // Fixed codes only: provider and database messages can contain credentials
    // or financial values even when they contain no URL.
    try { await writeConnection(admin, conn, { last_error: code }); } catch { /* keep the original failure */ }
    throw new BankSyncFailure(code);
  }
}

async function pullConnection(
  admin: SupabaseClient,
  conn: BankConnection,
  provider: ReturnType<typeof getProvider>,
): Promise<SyncResult> {
  const context = await readTransactionRuleContext(admin, conn.user_id);
  if (context.dropped > 0) throw new BankSyncFailure("bank-rules-unavailable");
  const rules = usableRules(context.rules);
  const evaluator = createRuleEvaluator(rules, {
    projectIds: new Set(context.projectIds), subscriptionIds: new Set(context.subscriptionIds),
  });

  let inserted = 0;
  let accountsLinked = 0;

  const accounts = await provider.listAccounts(conn);
  if (!Array.isArray(accounts) || accounts.length === 0 || accounts.length > 50) throw new BankSyncFailure("bank-data-unavailable");
  for (const account of accounts) {
    if (!account || typeof account.accountRef !== "string" || !account.accountRef || typeof account.name !== "string"
      || !(SUPPORTED_CURRENCIES as readonly string[]).includes(account.currency)
      || (account.balance !== null && (typeof account.balance !== "number" || !Number.isFinite(account.balance)))) {
      throw new BankSyncFailure("bank-data-unavailable");
    }

    // Resolve (or create) our local account row for this bank account.
    const { data: existing, error: lookupError } = await admin
      .from("accounts")
      .select("id")
      .eq("user_id", conn.user_id)
      .eq("external_ref", account.accountRef)
      .maybeSingle();

    if (lookupError) throw new BankSyncFailure("bank-write-unconfirmed");
    let accountId: string | null = existing?.id ?? null;
    if (accountId) {
      const { data, error } = await admin.from("accounts").update({
        ...(account.balance === null ? {} : { balance: account.balance }),
        currency: account.currency, updated_at: new Date().toISOString(),
      }).eq("id", accountId).eq("user_id", conn.user_id).select("id").single();
      if (error || data?.id !== accountId) throw new BankSyncFailure("bank-write-unconfirmed");
    } else {
      if (account.balance === null) throw new BankSyncFailure("bank-balance-unavailable");
      const { data, error } = await admin.from("accounts").insert({
        user_id: conn.user_id, name: account.name, balance: account.balance,
        currency: account.currency, external_ref: account.accountRef,
      }).select("id").single();
      if (error || !data?.id) throw new BankSyncFailure("bank-write-unconfirmed");
      accountId = data.id;
    }
    accountsLinked++;

    // Pull transactions and insert only the ones we haven't seen before.
    const provided = await provider.fetchTransactions(
      conn,
      account.accountRef,
      conn.sync_cursor,
    );
    if (!Array.isArray(provided) || provided.length > 20000) throw new BankSyncFailure("bank-data-unavailable");
    const rows = provided.map(tx => evaluator.applyToRow(bindTransaction(tx, conn.user_id, accountId)));
    // Database conflict handling covers the complete ledger, including rows
    // outside a REST page. Each confirmed batch is safe to replay after failure.
    for (let offset = 0; offset < rows.length; offset += 250) {
      inserted += await importTransactionBatch(admin, rows.slice(offset, offset + 250), conn.user_id);
    }
  }

  return { inserted, accountsLinked, status: "linked" };
}

/**
 * Sync exactly one connection the caller owns. This is what the per-connection
 * "Sync" button calls; the ownership filter is part of the query rather than a
 * check afterwards, so another owner's id simply resolves to nothing.
 */
export async function syncConnectionById(
  admin: SupabaseClient,
  userId: string,
  connectionId: string,
): Promise<SyncResult | null> {
  const { data, error } = await admin
    .from("bank_connections")
    .select("*")
    .eq("id", connectionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new BankSyncFailure("bank-write-unconfirmed");
  if (!data) return null;
  return syncConnection(admin, data as BankConnection);
}
