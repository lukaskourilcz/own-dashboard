import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { readOwnedCollection } from "@/lib/owned-records";

function backend(data: unknown, error: unknown = null) {
  const rpc = vi.fn(async () => ({ data, error }));
  return { rpc, client: { rpc } as unknown as SupabaseClient };
}
it("reads every record beyond the REST cap with one snapshot request", async () => {
  const records = Array.from({ length: 1201 }, (_, index) => ({ id: `row-${index}`, user_id: "owner" }));
  const { rpc, client } = backend(records);
  expect((await readOwnedCollection(client, "transactions", "owner")).data).toEqual(records);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("read_owned_collection", { p_entity: "transactions" });
});
it("accepts a genuinely empty collection without another count request", async () => {
  const { rpc, client } = backend([]);
  expect((await readOwnedCollection(client, "invoice_items", "owner")).data).toEqual([]);
  expect(rpc).toHaveBeenCalledOnce();
});
it("rejects provider failure instead of treating it as empty data", async () => {
  await expect(readOwnedCollection(backend([], new Error("Synthetic failure")).client, "prompts")).rejects.toThrow("Synthetic failure");
});
it("rejects malformed, duplicate or foreign response rows", async () => {
  await expect(readOwnedCollection(backend([{ id: "missing-owner" }]).client, "project_links")).rejects.toThrow("Invalid owned collection response");
  for (const data of [null, {}, [null], [{ id: 123 }], [{ id: "same" }, { id: "same" }], [{ id: "foreign", user_id: "other" }]]) {
    await expect(readOwnedCollection(backend(data).client, "prompt_links", "owner")).rejects.toThrow();
  }
});
it("retains a client transfer bound even if the provider returns an oversized response", async () => {
  await expect(readOwnedCollection(backend(Array(50_001).fill({ id: "row" })).client, "invoices")).rejects.toThrow("Owned collection unavailable");
});
