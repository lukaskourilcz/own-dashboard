import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Invoice } from "@/lib/types";

export type InvoicePaymentChange = { inv: Invoice; ownerId: string; paid: boolean; paidOn: string | null };
const receiptSchema = z.object({
  invoice: z.object({ id: z.string(), user_id: z.string(), status: z.enum(["draft", "issued", "paid"]),
    paid_on: z.iso.date().nullable(), updated_at: z.iso.datetime({ offset: true }) }).passthrough(),
  unlinked_transaction_ids: z.array(z.string().min(1)).max(1000),
});
export class InvoicePaymentChangeError extends Error {
  constructor(readonly conflict = false) { super("Invoice payment change unconfirmed"); }
}
export async function setInvoicePaymentState(client: SupabaseClient, change: InvoicePaymentChange) {
  if (change.inv.user_id !== change.ownerId || (change.paid ? !z.iso.date().safeParse(change.paidOn).success : change.paidOn !== null)) throw new InvoicePaymentChangeError();
  const { data, error } = await client.rpc("set_invoice_payment_state", {
    p_invoice_id: change.inv.id, p_expected_updated_at: change.inv.updated_at, p_paid: change.paid, p_paid_on: change.paidOn,
  });
  if (error) throw new InvoicePaymentChangeError(error.code === "40001" || error.code === "P0002");
  const parsed = receiptSchema.safeParse(data);
  if (!parsed.success) throw new InvoicePaymentChangeError();
  const { invoice, unlinked_transaction_ids: unlinkedIds } = parsed.data;
  if (invoice.id !== change.inv.id || invoice.user_id !== change.ownerId || invoice.status !== (change.paid ? "paid" : "issued")
    || invoice.paid_on !== change.paidOn || new Set(unlinkedIds).size !== unlinkedIds.length || (change.paid && unlinkedIds.length)) throw new InvoicePaymentChangeError();
  return { invoice: invoice as Invoice, unlinkedIds };
}
