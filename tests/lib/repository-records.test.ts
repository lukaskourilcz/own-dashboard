import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { consumeRepositoryRecords, saveRepositoryNote, createRepositoryNote } from "@/lib/repository-records";
import type { RepoNote } from "@/lib/types";
const owner = "11111111-1111-4111-8111-111111111111", id = "33333333-3333-4333-8333-333333333333", other = "44444444-4444-4444-8444-444444444444";
const note: RepoNote = { id, user_id: owner, repo_id: "123", repo_full_name: "owner/fixture", body: "Original", sort_order: 1, created_at: "2026-10-24T04:00:00Z", updated_at: "2026-10-24T04:00:00Z" };
function backend(response: unknown, error: unknown = null) {
  const rpc = vi.fn(() => ({ abortSignal: () => Promise.resolve({ data: response, error }) }));
  return { rpc, client: { rpc } as unknown as SupabaseClient };
}
it("requires a partition receipt naming every captured id once", async () => {
  const { client, rpc } = backend({ deleted_ids: [id], retained_ids: [other] });
  const result = await consumeRepositoryRecords(client, "repo_notes", [note, { ...note, id: other }]);
  expect(result.deleted).toEqual(new Set([id])); expect(result.retained).toEqual(new Set([other]));
  expect(rpc.mock.calls[0]).toEqual(["consume_repository_records", { p_entity: "repo_notes", p_rows: [note, { ...note, id: other }] }]);
});
it.each([{ deleted_ids: [id] }, { deleted_ids: [], retained_ids: [] }, { deleted_ids: [other], retained_ids: [] }, { deleted_ids: [id], retained_ids: [id] }, { deleted_ids: [id, id], retained_ids: [] }])("refuses incomplete, duplicate and foreign removal receipts", async response => {
  await expect(consumeRepositoryRecords(backend(response).client, "repo_notes", [note])).rejects.toThrow();
});
it("partitions large inputs without losing or double-counting a later batch", async () => {
  const rows = Array.from({ length: 501 }, (_, index) => ({ ...note, id: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}` }));
  const rpc = vi.fn((_name, input) => ({ abortSignal: () => Promise.resolve({ data: { deleted_ids: input.p_rows.map((row: RepoNote) => row.id), retained_ids: [] }, error: null }) }));
  const result = await consumeRepositoryRecords({ rpc } as unknown as SupabaseClient, "repo_notes", rows);
  expect(result.deleted.size).toBe(501); expect(rpc.mock.calls.map(call => call[1].p_rows.length)).toEqual([250, 250, 1]);
});
it("checks all request bounds before any partial removal", async () => {
  const { client, rpc } = backend({});
  await expect(consumeRepositoryRecords(client, "repo_notes", [note, note])).rejects.toThrow();
  await expect(consumeRepositoryRecords(client, "repo_notes", [note, { ...note, id: other, body: "x".repeat(900001) }])).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
});
it("checks the exact saved body and immutable source fields", async () => {
  const saved = { ...note, body: "Confirmed" };
  expect(await saveRepositoryNote(backend(saved).client, note, "Confirmed")).toEqual(saved);
  for (const altered of [{ ...saved, body: "Other" }, { ...saved, id: other }, { ...saved, user_id: other }, { ...saved, repo_id: "456" }, { ...saved, sort_order: 2 }, { ...saved, updated_at: "invalid" }]) {
    await expect(saveRepositoryNote(backend(altered).client, note, "Confirmed")).rejects.toThrow();
  }
  const { client, rpc } = backend(saved); await expect(saveRepositoryNote(client, note, "🚀".repeat(65537))).rejects.toThrow("too large"); expect(rpc).not.toHaveBeenCalled();
});
it("recovers the same creation identity after an ambiguous response without replacing its contents", async () => {
  const input = { id, user_id: owner, repo_id: "123", repo_full_name: "owner/fixture", sort_order: 1 };
  const upsert = vi.fn(() => ({ select: () => ({ abortSignal: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }));
  const eq = vi.fn(() => ({ abortSignal: () => ({ maybeSingle: async () => ({ data: { ...note, body: "Already edited" }, error: null }) }) }));
  const client = { from: () => ({ upsert, select: () => ({ eq }) }) } as unknown as SupabaseClient;
  expect((await createRepositoryNote(client, input)).body).toBe("Already edited");
  expect(upsert).toHaveBeenCalledWith({ ...input, body: "" }, { onConflict: "id", ignoreDuplicates: true }); expect(eq).toHaveBeenCalledWith("id", id);
});

it("captures every batch before waiting and stops before a later batch after cancellation", async () => {
 const controller = new AbortController();
 const rows = Array.from({ length: 251 }, (_, index) => ({ ...note, id: `33333333-3333-4333-8333-${String(index).padStart(12, '0')}` }));
 let release!: (value: unknown) => void;
 const rpc = vi.fn((name, input) => { expect(name).toBe('consume_repository_records'); expect(input.p_rows).toHaveLength(250); return { abortSignal: () => new Promise(resolve => { release = resolve; }) }; });
 const pending = consumeRepositoryRecords({ rpc } as unknown as SupabaseClient, 'repo_notes', rows, controller.signal);
 const failed = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
 rows[0].body = 'Changed while waiting'; expect(rpc.mock.calls[0][1].p_rows[0].body).toBe(note.body);
 controller.abort(); release({ data: { deleted_ids: rows.slice(0, 250).map(row => row.id), retained_ids: [] }, error: null }); await failed;
 expect(rpc).toHaveBeenCalledOnce();
 const untouched = backend({}); await expect(consumeRepositoryRecords(untouched.client, 'repo_notes', [note], controller.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(untouched.rpc).not.toHaveBeenCalled();
});
