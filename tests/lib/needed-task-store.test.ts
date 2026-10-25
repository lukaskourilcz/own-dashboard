import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { syncNeededTasks } from "@/lib/needed-task-store";
import { buildNeededRows } from "@/lib/needed-sync";
import type { GithubRepo } from "@/lib/github";
import type { Todo } from "@/lib/types";
const owner = "11111111-1111-4111-8111-111111111111", id = "33333333-3333-4333-8333-333333333333", staleId = "44444444-4444-4444-8444-444444444444";
const repo = { id: 123, owner: "owner", name: "fixture", full_name: "owner/fixture", html_url: "https://github.com/owner/fixture" } as GithubRepo;
const rows = buildNeededRows(owner, repo, "- [ ] Actual task [owner:ai]", repo.html_url, "2026-10-24T04:30:00Z");
const inserted = { ...rows[0], id, generated_at: "2026-10-24T04:30:00+00:00" };
const stale = { id: staleId, user_id: owner, source: "github", done: false } as Todo;
function backend(data: unknown, error: unknown = null) {
  const rpc = vi.fn((name: string, input: object) => { expect(name).toBe("sync_repository_tasks"); expect(input).toBeTypeOf("object"); return { abortSignal: () => Promise.resolve({ data, error }) }; });
  return { rpc, client: { rpc } as unknown as SupabaseClient };
}
it("accepts only matching inserted source fields and a complete removal partition", async () => {
  const { rpc, client } = backend({ inserted: [inserted], deleted_ids: [], retained_ids: [staleId] });
  expect(await syncNeededTasks(client, rows, [stale], new Set(["123"]))).toEqual({ added: 1, removed: 0, retained: 1, repos: 1 });
  expect(rpc.mock.calls[0]).toEqual(["sync_repository_tasks", { p_rows: rows, p_remove: [stale], p_scanned: ["123"] }]);
});
it.each([{}, { inserted: [inserted], deleted_ids: [] }, { inserted: [{ ...inserted, title: "Other" }], deleted_ids: [], retained_ids: [staleId] }, { inserted: [{ ...inserted, user_id: staleId }], deleted_ids: [], retained_ids: [staleId] }, { inserted: [inserted, inserted], deleted_ids: [], retained_ids: [staleId] }, { inserted: [], deleted_ids: [], retained_ids: [] }, { inserted: [], deleted_ids: [staleId], retained_ids: [staleId] }, { inserted: [], deleted_ids: [id], retained_ids: [] }])("refuses an incomplete, altered or foreign receipt", async data => {
  await expect(syncNeededTasks(backend(data).client, rows, [stale], new Set(["123"]))).rejects.toThrow();
});
it("allows an idempotent retry with no newly inserted source", async () => {
  expect(await syncNeededTasks(backend({ inserted: [], deleted_ids: [], retained_ids: [] }).client, rows)).toEqual({ added: 0, removed: 0, retained: 0, repos: 0 });
});
it("refuses conflicting/oversized inputs before a database call and skips empty work", async () => {
  const { client, rpc } = backend({});
  expect(await syncNeededTasks(client, [])).toEqual({ added: 0, removed: 0, retained: 0, repos: 0 });
  await expect(syncNeededTasks(client, [...rows, { ...rows[0], title: "Conflicting text" }])).rejects.toThrow("Conflicting");
  await expect(syncNeededTasks(client, Array(5001).fill(rows[0]))).rejects.toThrow("too large");
  expect(rpc).not.toHaveBeenCalled();
});

it("captures source inputs before a pending receipt and forwards parent cancellation", async () => {
 let release!: (value: unknown) => void;
 const signal = new AbortController();
 const rpc = vi.fn((name, input) => { expect(name).toBe('sync_repository_tasks'); expect(input.p_remove).toEqual([]); return { abortSignal: (bounded: AbortSignal) => { expect(bounded.aborted).toBe(false); return new Promise(resolve => { release = resolve; }); } }; });
 const input = structuredClone(rows), captured = structuredClone(input);
 const pending = syncNeededTasks({ rpc } as unknown as SupabaseClient, input, [], new Set(['123']), signal.signal);
 input[0].title = 'Changed while waiting';
 expect(rpc.mock.calls[0][1].p_rows).toEqual(captured);
 release({ data: { inserted: [{ ...inserted, ...captured[0] }], deleted_ids: [], retained_ids: [] }, error: null });
 await expect(pending).resolves.toMatchObject({ added: 1 });
 signal.abort(); const untouched = backend({});
 await expect(syncNeededTasks(untouched.client, captured, [], new Set(), signal.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(untouched.rpc).not.toHaveBeenCalled();
});
