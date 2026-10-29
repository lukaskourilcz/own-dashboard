// @vitest-environment happy-dom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSpendCategories } from "@/lib/use-spend-categories";
import { OwnerPreferencesProvider } from "@/lib/owner-preferences";
import { qk } from "@/lib/queries/keys";
const state = vi.hoisted(() => ({ api: null as unknown as SupabaseClient }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => state.api }));
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const original = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", user_id: owner, name: "Software", sort_order: 1, created_at: "2026-10-25T00:00:00Z" };
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, qc: QueryClient, api: ReturnType<typeof useSpendCategories>;
let requests: Array<{ method: string; body: Record<string, unknown> | null; signal: AbortSignal | null | undefined }>, writes: Array<(response: Response) => void>;
function Probe() { const value = useSpendCategories(); useLayoutEffect(() => { api = value; }); return <output>{JSON.stringify(value.categories)}</output>; }
function View({ id = owner }: { id?: string }) { return <QueryClientProvider client={qc}><OwnerPreferencesProvider ownerId={id}><Probe /></OwnerPreferencesProvider></QueryClientProvider>; }
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const rows = () => JSON.parse(host.querySelector("output")!.textContent!);
beforeEach(async () => {
  requests = []; writes = []; qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.api = createClient("https://example.supabase.co", "test-only-anon", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async (_input, init) => {
    const method = init?.method ?? "GET"; requests.push({ method, body: typeof init?.body === "string" ? JSON.parse(init.body) : null, signal: init?.signal });
    if (method === "GET") return Response.json([original], { headers: { "content-range": "0-0/1" } });
    return new Promise<Response>(resolve => writes.push(resolve));
  } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); await act(async () => root.render(<View />)); await vi.waitFor(async () => { await settle(); expect(api.ready).toBe(true); });
});
afterEach(() => { act(() => root.unmount()); host.remove(); qc.clear(); vi.restoreAllMocks(); });
it("waits for confirmation before adding to the owned cache", async () => {
  let pending!: ReturnType<typeof api.addCategory>; act(() => { pending = api.addCategory("Cloud"); }); await vi.waitFor(() => expect(writes).toHaveLength(1)); expect(rows()).toEqual([original]);
  const command = requests.find(request => request.method === "POST")!.body!; expect(command).toMatchObject({ user_id: owner, name: "Cloud", sort_order: 2 });
  await act(async () => { writes[0]!(Response.json({ id: command.id, user_id: owner, name: "Cloud", sort_order: 2, created_at: original.created_at }, { status: 201 })); await pending; }); await settle();
  expect(rows().map((row: { name: string }) => row.name)).toEqual(["Software", "Cloud"]); expect(qc.getQueryData([...qk.spendCategories, other])).toBeUndefined();
});
it("retains a failed creation identity and never rolls back a whole list on failed removal", async () => {
  let first!: ReturnType<typeof api.addCategory>; act(() => { first = api.addCategory("Cloud"); }); const failed = expect(first).rejects.toThrow(); await vi.waitFor(() => expect(writes).toHaveLength(1));
  await act(async () => { writes[0]!(Response.json({ message: "PRIVATE TEST failure" }, { status: 503 })); await failed; });
  let retry!: ReturnType<typeof api.addCategory>; act(() => { retry = api.addCategory("Cloud"); }); const failedAgain = expect(retry).rejects.toThrow(); await vi.waitFor(() => expect(writes).toHaveLength(2));
  const commands = requests.filter(request => request.method === "POST"); expect(commands[0].body).toEqual(commands[1].body);
  await act(async () => { writes[1]!(Response.json({ message: "failed" }, { status: 503 })); await failedAgain; }); expect(rows()).toEqual([original]);
  let deletion!: ReturnType<typeof api.removeCategory>; act(() => { deletion = api.removeCategory(original); }); const deletionFailed = expect(deletion).rejects.toThrow(); await vi.waitFor(() => expect(writes).toHaveLength(3));
  const newer = { ...original, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Newer" }; await act(async () => { qc.setQueryData([...qk.spendCategories, owner], [original, newer]); await new Promise(resolve => setTimeout(resolve, 0)); });
  await act(async () => { writes[2]!(Response.json({ message: "failed" }, { status: 503 })); await deletionFailed; }); expect(rows()).toEqual([original, newer]);
});
it("cancels an old owner action and refuses a foreign response under the new cache key", async () => {
  let pending!: ReturnType<typeof api.addCategory>; act(() => { pending = api.addCategory("Cloud"); }); const failed = expect(pending).rejects.toThrow(); await vi.waitFor(() => expect(writes).toHaveLength(1));
  const post = requests.find(request => request.method === "POST")!;
  await act(async () => root.render(<View id={other} />)); await failed; expect(post.signal?.aborted).toBe(true);
  await vi.waitFor(async () => { await settle(); expect(api.failed).toBe(true); }); expect(rows()).toEqual([]); expect(qc.getQueryData([...qk.spendCategories, owner])).toEqual([original]);
  await act(async () => { writes[0]!(Response.json({ ...original, id: post.body!.id, name: "Cloud", sort_order: 2 }, { status: 201 })); }); expect(rows()).toEqual([]);
});
