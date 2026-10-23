import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { importTransactionBatch } from "@/lib/transaction-import";

const id = "11111111-1111-4111-8111-111111111111";
const row = { account_id: null, kind: "expense" as const, amount: 1, currency: "CZK", category: null, note: null,
  occurred_on: "2026-10-23", external_id: "synthetic", variable_symbol: null, project_id: null, subscription_id: null };
it.each([null, {}, ["not-an-id"], [id, id], [id, "22222222-2222-4222-8222-222222222222"]])("refuses unconfirmed or oversized receipts (%j)", async data => {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  await expect(importTransactionBatch({ rpc } as unknown as SupabaseClient, [row])).rejects.toThrow();
});
it("allowlists payload fields and passes verified service ownership separately", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: [id], error: null });
  expect(await importTransactionBatch({ rpc } as unknown as SupabaseClient, [{ ...row, user_id: "foreign", invoice_id: id } as typeof row], "owner")).toBe(1);
  expect(rpc).toHaveBeenCalledWith("import_transaction_batch", { p_rows: [row], p_user_id: "owner" });
  rpc.mockResolvedValue({ data: null, error: new Error("Synthetic private upstream detail") });
  await expect(importTransactionBatch({ rpc } as unknown as SupabaseClient, [row])).rejects.toThrow("Import not confirmed");
});
