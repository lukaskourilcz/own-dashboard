import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

type ImportRow = {
  account_id: string | null; kind: "income" | "expense"; amount: number; currency: string;
  category: string | null; note: string | null; occurred_on: string; external_id: string;
  variable_symbol: string | null; project_id: string | null; subscription_id: string | null;
};
const receiptSchema = z.array(z.uuid()).max(250);

/** One confirmed, atomic batch under the existing partial unique index. The
 * server binds ownership; callers cannot supply user or payment-link fields. */
async function importBatch(client: SupabaseClient, rows: readonly ImportRow[], ownerId: string | undefined, bank: boolean, signal?: AbortSignal): Promise<number> {
  if (rows.length > 250) throw new Error("Import batch too large");
  const payload = rows.map(row => ({
    account_id: row.account_id, kind: row.kind, amount: row.amount, currency: row.currency,
    category: row.category, note: row.note, occurred_on: row.occurred_on, external_id: row.external_id,
    variable_symbol: row.variable_symbol, project_id: row.project_id, subscription_id: row.subscription_id,
  }));
  const query = client.rpc(bank ? "import_bank_transaction_batch" : "import_transaction_batch", { p_rows: payload, p_user_id: ownerId ?? null });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw new Error("Import not confirmed");
  const receipt = receiptSchema.parse(data);
  if (receipt.length > rows.length || new Set(receipt).size !== receipt.length) throw new Error("Invalid import receipt");
  return receipt.length;
}

export function importTransactionBatch(client: SupabaseClient, rows: readonly ImportRow[], ownerId?: string): Promise<number> {
  return importBatch(client, rows, ownerId, false);
}

/** Bank identities are account-scoped in SQL; existing legacy imports remain
 * recognized without rewriting owner records or changing CSV fingerprints. */
export function importBankTransactionBatch(client: SupabaseClient, rows: readonly ImportRow[], ownerId: string, signal?: AbortSignal): Promise<number> {
  return importBatch(client, rows, ownerId, true, signal);
}
