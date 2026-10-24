import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { readOwnedCollection } from "@/lib/owned-records";

function backend(data: unknown, error: unknown = null) {
  const retry = vi.fn(), abortSignal = vi.fn();
  const query = { retry: (value: boolean) => { retry(value); return query; }, abortSignal: (signal: AbortSignal) => { abortSignal(signal); return query; }, then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve, reject) };
  const rpc = vi.fn(() => query);
  return { rpc, retry, abortSignal, client: { rpc } as unknown as SupabaseClient };
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

it("disables hidden retries and propagates a complete-read signal for project metadata", async () => {
  const service = backend([{ id: "project", user_id: "owner" }]);
  await readOwnedCollection(service.client, "projects", "owner"); expect(service.retry).toHaveBeenCalledWith(false); expect(service.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
});
it("refuses already cancelled collection work before constructing an RPC", async () => {
  const service = backend([]), stop = new AbortController(); stop.abort("PRIVATE");
  await expect(readOwnedCollection(service.client, "crons", "owner", stop.signal)).rejects.toMatchObject({ name: "AbortError" }); expect(service.rpc).not.toHaveBeenCalled();
});
it("settles a stalled complete read when its caller aborts", async () => {
  const stop = new AbortController(); const query = { retry: () => query, abortSignal: () => query, then: () => new Promise(() => undefined) };
  const client = { rpc: () => query } as unknown as SupabaseClient; const pending = readOwnedCollection(client, "project_costs", "owner", stop.signal); stop.abort("PRIVATE");
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
