import type { SupabaseClient } from "@supabase/supabase-js";
import type { Invoice } from "@/lib/types";
import { expect, it, vi } from "vitest";
import { setInvoicePaymentState } from "@/lib/invoice-payment-state";
const inv = { id: "invoice", user_id: "owner", updated_at: "2026-10-24T00:00:00Z" } as Invoice;
it.each([null, {}, { invoice: { ...inv, status: "issued", paid_on: null }, unlinked_transaction_ids: ["same", "same"] }, { invoice: { ...inv, user_id: "another", status: "issued", paid_on: null }, unlinked_transaction_ids: [] }])("never confirms an absent, duplicate or foreign payment receipt (%#)", async data => {
  const client = { rpc: async () => ({ data, error: null }) } as unknown as SupabaseClient;
  await expect(setInvoicePaymentState(client, { inv, ownerId: "owner", paid: false, paidOn: null })).rejects.toThrow("unconfirmed");
});
it("refuses a foreign cached invoice before sending a mutation", async () => {
  const rpc = vi.fn();
  await expect(setInvoicePaymentState({ rpc } as unknown as SupabaseClient, { inv, ownerId: "another", paid: false, paidOn: null })).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
});
