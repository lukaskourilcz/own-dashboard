import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getProvider } from "@/lib/bank/registry";
import { bindTransaction, type ProviderConsent } from "@/lib/bank/provider";
import {
  applyRulesToRow,
  parseRules,
  usableRules,
  type OwnedIds,
} from "@/lib/transaction-rules";
import type { BankConnection } from "@/lib/types";

/**
 * The owner's own project and subscription ids. A rule action may name either,
 * and the transactions insert/update policies verify the row belongs to the
 * same owner — so an id that is not in these sets is dropped before the write
 * rather than turning into a rejected insert.
 */
async function ownedIds(admin: SupabaseClient, userId: string): Promise<OwnedIds> {
  const [projects, subscriptions] = await Promise.all([
    admin.from("projects").select("id").eq("user_id", userId),
    admin.from("subscriptions").select("id").eq("user_id", userId),
  ]);
  const ids = (rows: { id: string }[] | null) =>
    new Set<string>((rows ?? []).map((row) => row.id));
  return {
    projectIds: ids(projects.data as { id: string }[] | null),
    subscriptionIds: ids(subscriptions.data as { id: string }[] | null),
  };
}

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
export async function syncConnection(
  admin: SupabaseClient,
  conn: BankConnection,
): Promise<SyncResult> {
  const provider = getProvider(conn.provider);

  let consent: ProviderConsent;
  try {
    consent = await provider.getConsent(conn);
  } catch (error) {
    await admin
      .from("bank_connections")
      .update({ last_error: describeError(error) })
      .eq("id", conn.id);
    throw error;
  }

  const status = nextStatus(conn.status, consent);
  if (consent.status !== "linked") {
    await admin
      .from("bank_connections")
      .update({
        status,
        consent_expires_at: consent.expiresAt,
        last_error: consent.error,
      })
      .eq("id", conn.id);
    return { inserted: 0, accountsLinked: 0, status };
  }

  try {
    const result = await pullConnection(admin, conn, provider);
    await admin
      .from("bank_connections")
      .update({
        status: "linked",
        consent_expires_at: consent.expiresAt,
        last_error: null,
        sync_cursor: new Date().toISOString().slice(0, 10),
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", conn.id);
    return result;
  } catch (error) {
    await admin
      .from("bank_connections")
      .update({ last_error: describeError(error) })
      .eq("id", conn.id);
    throw error;
  }
}

/** A short, non-sensitive reason for the connection row. Provider errors can
 *  carry a URL with a token in it, so only the error's name and a truncated
 *  message are kept, never a request URL. */
function describeError(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : "sync failed";
  return raw.replace(/https?:\/\/\S+/g, "[url]").slice(0, 200);
}

async function pullConnection(
  admin: SupabaseClient,
  conn: BankConnection,
  provider: ReturnType<typeof getProvider>,
): Promise<SyncResult> {
  // Existing dedupe key set for this user — cheap at personal scale.
  const { data: existingRows } = await admin
    .from("transactions")
    .select("external_id")
    .eq("user_id", conn.user_id)
    .not("external_id", "is", null);
  const seen = new Set<string>(
    (existingRows ?? []).map((r: { external_id: string }) => r.external_id),
  );

  // Transaction rules — the same staged, specificity-ranked engine the editor
  // and the retroactive apply route use, so a synced row is filed exactly as
  // the preview said it would be.
  const { data: ruleRows } = await admin
    .from("transaction_rules")
    .select("*")
    .eq("user_id", conn.user_id)
    .order("stage", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  const rules = usableRules(parseRules(ruleRows ?? []).rules);

  // A rule action naming a project or subscription the owner no longer has
  // would be rejected by the transactions insert policy, so unknown ids are
  // dropped before the row is built.
  const owned = await ownedIds(admin, conn.user_id);

  let inserted = 0;
  let accountsLinked = 0;

  for (const account of await provider.listAccounts(conn)) {
    accountsLinked++;

    // Resolve (or create) our local account row for this bank account.
    const { data: existing } = await admin
      .from("accounts")
      .select("id")
      .eq("user_id", conn.user_id)
      .eq("external_ref", account.accountRef)
      .maybeSingle();

    let accountId: string | null = existing?.id ?? null;
    if (accountId) {
      await admin
        .from("accounts")
        .update({
          balance: account.balance ?? 0,
          currency: account.currency,
          updated_at: new Date().toISOString(),
        })
        .eq("id", accountId);
    } else {
      const { data: created } = await admin
        .from("accounts")
        .insert({
          user_id: conn.user_id,
          name: account.name,
          balance: account.balance ?? 0,
          currency: account.currency,
          external_ref: account.accountRef,
        })
        .select("id")
        .single();
      accountId = created?.id ?? null;
    }

    // Pull transactions and insert only the ones we haven't seen before.
    const provided = await provider.fetchTransactions(
      conn,
      account.accountRef,
      conn.sync_cursor,
    );
    const rows = provided
      .filter((tx) => Boolean(tx.occurred_on))
      .filter((tx) => !seen.has(tx.external_id))
      .map((tx) =>
        applyRulesToRow(
          bindTransaction(tx, conn.user_id, accountId),
          rules,
          owned,
        ),
      );

    // Guard against duplicates within this batch too.
    const batch: typeof rows = [];
    for (const row of rows) {
      if (seen.has(row.external_id)) continue;
      seen.add(row.external_id);
      batch.push(row);
    }

    if (batch.length) {
      const { error } = await admin.from("transactions").insert(batch);
      if (!error) inserted += batch.length;
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
  const { data } = await admin
    .from("bank_connections")
    .select("*")
    .eq("id", connectionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return syncConnection(admin, data as BankConnection);
}
