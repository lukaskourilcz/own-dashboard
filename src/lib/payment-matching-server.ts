import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeTotals } from "@/lib/invoices";
import {
  matchPayments,
  type MatchableInvoice,
  type MatchableTransaction,
  type MatchResult,
} from "@/lib/payment-matching";

/**
 * Run the deterministic payment matcher for one owner and write what it found.
 *
 * Works with either client: the cron passes the service-role client and scopes
 * every query by `user_id` itself, the on-demand button passes the owner's own
 * session client and own-only RLS scopes it. Neither path can reach another
 * owner's rows, because nothing here selects without a `user_id` filter.
 *
 * Idempotent. A matched payment gets `invoice_id`, so the next run's
 * "unlinked income" query no longer returns it and the invoice is no longer
 * `issued`.
 */

// A personal ledger is small; the cap keeps one pathological account from
// holding a cron invocation open.
const TRANSACTION_LIMIT = 500;

const INVOICE_SELECT = "id, number, variable_symbol, currency, status, round_total, issue_date";
const TRANSACTION_SELECT =
  "id, kind, amount, currency, note, occurred_on, variable_symbol, invoice_id";

type InvoiceRow = MatchableInvoice & { issue_date: string };

type ItemRow = {
  invoice_id: string;
  quantity: number | string;
  unit_price: number | string;
  vat_rate: number | string;
};

export type RunResult = MatchResult & {
  /** Links actually written. Lower than `matched.length` if a write was rejected. */
  linked: number;
};

/** Invoice id → amount due, derived from items exactly as the invoice prints it. */
export function buildTotals(invoices: InvoiceRow[], items: ItemRow[]): Map<string, number> {
  const byInvoice = new Map<string, ItemRow[]>();
  for (const item of items) {
    const bucket = byInvoice.get(item.invoice_id);
    if (bucket) bucket.push(item);
    else byInvoice.set(item.invoice_id, [item]);
  }
  const totals = new Map<string, number>();
  for (const invoice of invoices) {
    const rows = byInvoice.get(invoice.id) ?? [];
    const { total } = computeTotals(
      rows.map((row) => ({
        quantity: Number(row.quantity),
        unit_price: Number(row.unit_price),
        vat_rate: Number(row.vat_rate),
      })),
      { roundTotal: invoice.round_total, currency: invoice.currency },
    );
    totals.set(invoice.id, total);
  }
  return totals;
}

export async function runPaymentMatching(
  client: SupabaseClient,
  userId: string,
): Promise<RunResult> {
  const { data: invoiceData, error: invoiceError } = await client
    .from("invoices")
    .select(INVOICE_SELECT)
    .eq("user_id", userId)
    .in("status", ["issued", "paid"])
    .eq("payment_method", "bank");
  if (invoiceError) throw new Error(invoiceError.message);
  const invoices = (invoiceData ?? []) as InvoiceRow[];

  const open = invoices.filter((invoice) => invoice.status === "issued");
  if (open.length === 0) {
    return { matched: [], unmatched: [], scanned: 0, linked: 0 };
  }

  const { data: itemData, error: itemError } = await client
    .from("invoice_items")
    .select("invoice_id, quantity, unit_price, vat_rate")
    .eq("user_id", userId)
    .in("invoice_id", open.map((invoice) => invoice.id));
  if (itemError) throw new Error(itemError.message);

  // A payment cannot predate the oldest invoice still waiting for it.
  const since = open.reduce(
    (oldest, invoice) => (invoice.issue_date < oldest ? invoice.issue_date : oldest),
    open[0].issue_date,
  );

  const { data: txData, error: txError } = await client
    .from("transactions")
    .select(TRANSACTION_SELECT)
    .eq("user_id", userId)
    .eq("kind", "income")
    .is("invoice_id", null)
    .gte("occurred_on", since)
    .order("occurred_on", { ascending: true })
    .limit(TRANSACTION_LIMIT);
  if (txError) throw new Error(txError.message);

  const transactions = ((txData ?? []) as (MatchableTransaction & { amount: number | string })[]).map(
    (row) => ({ ...row, amount: Number(row.amount) }),
  );

  const result = matchPayments({
    // Paid invoices are passed too, with no total: they are what turns a second
    // payment quoting a settled symbol into "already paid" rather than
    // "unknown reference".
    invoices,
    totals: buildTotals(open, (itemData ?? []) as ItemRow[]),
    transactions,
  });

  const byId = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const byTransaction = new Map(transactions.map((tx) => [tx.id, tx]));
  let linked = 0;

  for (const match of result.matched) {
    const tx = byTransaction.get(match.transactionId);
    const invoice = byId.get(match.invoiceId);
    if (!tx || !invoice) continue;
    const written = await linkPayment(client, userId, {
      transactionId: match.transactionId,
      invoiceId: match.invoiceId,
      paidOn: tx.occurred_on,
      source: "auto",
    });
    if (!written) continue;
    linked++;
    await notifyPaid(client, userId, {
      invoiceId: invoice.id,
      number: invoice.number,
      amount: match.total,
      currency: invoice.currency,
      paidOn: tx.occurred_on,
    });
  }

  return { ...result, linked };
}

/**
 * Write one payment→invoice link. Returns false when either write is rejected
 * (a foreign invoice, an already-linked payment) so the caller never reports a
 * link it did not make.
 *
 * Both statements carry `user_id`, so the service-role path is scoped the same
 * way the session path is scoped by RLS.
 */
export async function linkPayment(
  client: SupabaseClient,
  userId: string,
  input: {
    transactionId: string;
    invoiceId: string;
    paidOn: string;
    source: "auto" | "manual";
  },
): Promise<boolean> {
  const { data, error } = await client
    .from("transactions")
    .update({
      invoice_id: input.invoiceId,
      matched_at: new Date().toISOString(),
      match_source: input.source,
    })
    .eq("id", input.transactionId)
    .eq("user_id", userId)
    .is("invoice_id", null)
    .select("id");
  if (error || (data ?? []).length === 0) return false;

  const { error: invoiceError } = await client
    .from("invoices")
    .update({
      status: "paid",
      // The day the money arrived, not the day the matcher ran.
      paid_on: input.paidOn,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.invoiceId)
    .eq("user_id", userId);
  if (invoiceError) {
    // Undo the half-written link rather than leaving a payment attached to an
    // invoice that still reads as unpaid.
    await client
      .from("transactions")
      .update({ invoice_id: null, matched_at: null, match_source: null })
      .eq("id", input.transactionId)
      .eq("user_id", userId);
    return false;
  }
  return true;
}

/** Best effort: a failed notification must not undo a correct match. */
async function notifyPaid(
  client: SupabaseClient,
  userId: string,
  invoice: { invoiceId: string; number: string; amount: number; currency: string; paidOn: string },
): Promise<void> {
  try {
    await client.from("notifications").insert({
      user_id: userId,
      kind: "invoice-paid",
      source_type: "invoice",
      source_id: invoice.invoiceId,
      title: `Invoice ${invoice.number} paid`,
      body: `${invoice.amount.toFixed(2)} ${invoice.currency} received on ${invoice.paidOn}.`,
      action_url: "/invoices",
    });
  } catch {
    // swallow — notifications are reporting, not the product contract
  }
}
