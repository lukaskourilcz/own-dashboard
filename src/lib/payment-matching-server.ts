import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeTotals } from "@/lib/invoices";
import {
  matchPayments,
  type MatchableInvoice,
  type MatchResult,
} from "@/lib/payment-matching";

import { z } from "zod";

const id = z.uuid();
const hash = z.string().regex(/^[a-f0-9]{32}$/);
const invoiceSchema = z.object({
  id, number: z.string(), variable_symbol: z.string().nullable(), currency: z.string(), status: z.string(),
  round_total: z.boolean(), issue_date: z.iso.date(), updated_at: z.iso.datetime({ offset: true }),
  payment_method: z.string(), items_version: hash.nullable(),
});
const transactionSchema = z.object({
  id, kind: z.enum(["income", "expense"]), amount: z.number().finite().nonnegative(), currency: z.string(),
  note: z.string().nullable(), occurred_on: z.iso.date(), variable_symbol: z.string().nullable(),
  invoice_id: id.nullable(), match_version: hash,
});
const snapshotSchema = z.object({
  invoices: z.array(invoiceSchema).max(10000),
  items: z.array(z.object({ id, invoice_id: id, quantity: z.number().finite(), unit_price: z.number().finite(), vat_rate: z.number().finite() })).max(50000),
  transactions: z.array(transactionSchema).max(20000),
});
const receiptSchema = z.array(z.object({ transaction_id: id, invoice_id: id, paid_on: z.iso.date(), changed: z.boolean() })).max(100);
export type MatchingInvoice = z.infer<typeof invoiceSchema>;
export type MatchingTransaction = z.infer<typeof transactionSchema>;
type Receipt = z.infer<typeof receiptSchema>[number];
type InvoiceRow = MatchableInvoice & { issue_date: string };
type ItemRow = { invoice_id: string; quantity: number | string; unit_price: number | string; vat_rate: number | string };
export type RunResult = MatchResult & { linked: number };

/** One complete, bounded MVCC snapshot for verified owner/session or service
 * callers. Versions detect changed amounts, dates, headers and invoice lines.
 * It performs no tax calculation or model call.
 */
export async function readPaymentMatchingSnapshot(client: SupabaseClient, userId: string,
  filter: { transactionId?: string; invoiceId?: string } = {}) {
  const { data, error } = await client.rpc("payment_matching_snapshot", {
    p_user_id: userId, p_transaction_id: filter.transactionId ?? null, p_invoice_id: filter.invoiceId ?? null,
  });
  if (error) throw new Error("Payment snapshot unavailable");
  const snapshot = snapshotSchema.parse(data);
  for (const rows of [snapshot.invoices, snapshot.items, snapshot.transactions]) {
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("Duplicate matching records");
  }
  return snapshot;
}

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

type PaymentInput = { invoice: MatchingInvoice; transaction: MatchingTransaction; source: "auto" | "manual" };
async function settlePayments(client: SupabaseClient, userId: string, matches: PaymentInput[]): Promise<Receipt[]> {
  if (!matches.length) return [];
  const { data, error } = await client.rpc("settle_invoice_payments", { p_user_id: userId,
    p_matches: matches.map(({ invoice, transaction, source }) => ({
      invoice_id: invoice.id, transaction_id: transaction.id, source,
      invoice_updated_at: invoice.updated_at, items_version: invoice.items_version, transaction_version: transaction.match_version,
    })),
  });
  if (error) throw new Error("Payment settlement not confirmed");
  const receipts = receiptSchema.parse(data);
  const wanted = new Set(matches.map(m => `${m.transaction.id}:${m.invoice.id}`));
  const returned = receipts.map(r => `${r.transaction_id}:${r.invoice_id}`);
  if (new Set(returned).size !== returned.length || returned.some(pair => !wanted.has(pair))) throw new Error("Invalid settlement receipt");
  return receipts;
}

/** Match all eligible payments, then settle at most 100 pairs in one bounded
 * transaction. Older unmatched rows cannot hide later eligible payments.
 * Remaining pairs stay eligible for the next pass; notifications are one
 * best-effort insert and never undo settlement.
 */
export async function runPaymentMatching(client: SupabaseClient, userId: string): Promise<RunResult> {
  const snapshot = await readPaymentMatchingSnapshot(client, userId);
  const open = snapshot.invoices.filter(invoice => invoice.status === "issued");
  if (!open.length) return { matched: [], unmatched: [], scanned: 0, linked: 0 };
  const result = matchPayments({ invoices: snapshot.invoices, totals: buildTotals(open, snapshot.items), transactions: snapshot.transactions });
  const invoices = new Map(snapshot.invoices.map(invoice => [invoice.id, invoice]));
  const transactions = new Map(snapshot.transactions.map(transaction => [transaction.id, transaction]));
  const receipts = await settlePayments(client, userId, result.matched.slice(0, 100).map(match => ({
    invoice: invoices.get(match.invoiceId)!, transaction: transactions.get(match.transactionId)!, source: "auto",
  })));
  const confirmed = receipts.filter(receipt => receipt.changed);
  if (confirmed.length) {
    const totals = new Map(result.matched.map(match => [match.invoiceId, match.total]));
    try {
      await client.from("notifications").insert(confirmed.map(receipt => {
        const invoice = invoices.get(receipt.invoice_id)!;
        return { user_id: userId, kind: "invoice-paid", source_type: "invoice", source_id: invoice.id,
          title: `Invoice ${invoice.number} paid`, body: `${totals.get(invoice.id)!.toFixed(2)} ${invoice.currency} received on ${receipt.paid_on}.`, action_url: "/invoices" };
      }));
    } catch { /* Notification delivery never changes the financial result. */ }
  }
  return { ...result, linked: confirmed.length };
}

/** A manual link is the owner's explicit settlement decision. Both rows are
 * checked and written in the same transaction, with a canonical receipt/date.
 */
export async function linkPayment(client: SupabaseClient, userId: string,
  input: { invoice: MatchingInvoice; transaction: MatchingTransaction }): Promise<Receipt | null> {
  return (await settlePayments(client, userId, [{ ...input, source: "manual" }]))[0] ?? null;
}
