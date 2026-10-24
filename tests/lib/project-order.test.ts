import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { applyProjectOrder, reorderOwnedProjects } from "@/lib/project-order";
import type { Project } from "@/lib/types";
const owner = "11111111-1111-4111-8111-111111111111", stamp = "2026-10-24T09:00:00Z", next = "2026-10-24T09:01:00Z";
const a = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", user_id: owner, name: "A", slug: "a", sort_order: 0, is_active: true, engagement: "own", parent_id: null, updated_at: stamp, created_at: stamp, notes: "Owned text", url: null, repo_full_name: null, color: null } satisfies Project;
const b: Project = { ...a, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "B", slug: "b", sort_order: 1 };
const receipt = [{ id: a.id, user_id: owner, sort_order: 1, updated_at: next }, { id: b.id, user_id: owner, sort_order: 0, updated_at: next }];
function backend(data: unknown = receipt, error: unknown = null) {
  const retry = vi.fn(), abortSignal = vi.fn();
  const query = { retry: (value: boolean) => { retry(value); return query; }, abortSignal: (signal: AbortSignal) => { abortSignal(signal); return query; }, then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve, reject) };
  const rpc = vi.fn(() => query); return { rpc, retry, abortSignal, client: { rpc } as unknown as SupabaseClient };
}
it("uses one bounded, non-retrying transaction and omits private project bodies", async () => {
  const service = backend(); expect(await reorderOwnedProjects(service.client, [{ ...a, notes: "x".repeat(2097152) }, b], [b.id, a.id])).toEqual(receipt);
  expect(service.rpc).toHaveBeenCalledOnce(); expect(service.rpc.mock.calls[0]).toEqual(["reorder_owned_projects", { p_rows: [
    { id: b.id, user_id: owner, updated_at: stamp, previous_sort_order: 1, sort_order: 0, engagement: "own", parent_id: null, is_active: true },
    { id: a.id, user_id: owner, updated_at: stamp, previous_sort_order: 0, sort_order: 1, engagement: "own", parent_id: null, is_active: true },
  ] }]); expect(service.retry).toHaveBeenCalledWith(false); expect(service.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
});
it("does no work for unchanged normalized positions", async () => {
  const service = backend([]); expect(await reorderOwnedProjects(service.client, [a, b], [a.id, b.id])).toEqual([]); expect(service.rpc).not.toHaveBeenCalled();
});
it("refuses duplicate, missing, foreign, cross-group, inactive and child sources before writing", async () => {
  const service = backend();
  for (const [rows, ids] of [[[a, b], [a.id, a.id]], [[a, b], [a.id]], [[a, a], [a.id, b.id]], [[a, b], [a.id, crypto.randomUUID()]], [[a, { ...b, user_id: crypto.randomUUID() }], [b.id, a.id]], [[a, { ...b, engagement: "client" }], [b.id, a.id]], [[a, { ...b, is_active: false }], [b.id, a.id]], [[a, { ...b, parent_id: a.id }], [b.id, a.id]]] as [Project[], string[]][]) await expect(reorderOwnedProjects(service.client, rows, ids)).rejects.toThrow();
  expect(service.rpc).not.toHaveBeenCalled();
});
it("refuses failed, partial, duplicate, foreign, altered and non-advancing receipts", async () => {
  for (const data of [null, {}, [], [receipt[0]], [receipt[0], receipt[0]], receipt.map(row => ({ ...row, user_id: crypto.randomUUID() })), receipt.map(row => ({ ...row, sort_order: 9 })), receipt.map(row => ({ ...row, updated_at: stamp })), receipt.map(row => ({ ...row, notes: "unexpected" }))]) await expect(reorderOwnedProjects(backend(data).client, [a, b], [b.id, a.id])).rejects.toThrow();
  await expect(reorderOwnedProjects(backend(receipt, Error("Synthetic unavailable")).client, [a, b], [b.id, a.id])).rejects.toThrow("Project order unconfirmed");
});
it("preserves unrelated cache rows, fields, edits and removals instead of rolling back a whole list", () => {
  const newer = { ...b, updated_at: "2026-10-24T09:02:00Z", name: "Newer edit" }, extra = { ...a, id: crypto.randomUUID(), name: "New" };
  const rows = applyProjectOrder([{ ...a, notes: "Unrelated retained cache field" }, newer, extra], [a, b], receipt);
  expect(rows[0]).toEqual({ ...a, notes: "Unrelated retained cache field", sort_order: 1, updated_at: next }); expect(rows[1]).toBe(newer); expect(rows[2]).toBe(extra);
  expect(applyProjectOrder([b], [a, b], receipt).map(row => row.id)).toEqual([b.id]);
  for (const patch of [{ is_active: false }, { parent_id: b.id }, { sort_order: 4 }, { engagement: "client" as const }]) { const changed = { ...a, ...patch }; expect(applyProjectOrder([changed], [a, b], receipt)[0]).toBe(changed); }
});
