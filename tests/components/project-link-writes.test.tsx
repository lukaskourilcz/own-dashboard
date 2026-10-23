// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { useProjectLinkMutations } from "@/components/links/use-project-links";
import { qk } from "@/lib/queries/keys";
import type { ProjectLink, Updater } from "@/lib/types";
const state = vi.hoisted(() => ({ write: vi.fn(), auth: vi.fn(), filters: [] as unknown[] }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ ok: vi.fn(), err: vi.fn() }) }));
vi.mock("@/lib/supabase/user", () => ({ currentUserId: () => state.auth() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: () => {
  const chain = { eq: (key: string, value: unknown) => { state.filters.push([key, value]); return chain; },
    select: () => chain, single: () => state.write("update"), in: () => state.write("remove") };
  return { update: () => chain, delete: () => chain, upsert: (rows: unknown) => ({ select: () => state.write("upsert", rows) }) };
} }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, qc: QueryClient, api: ReturnType<typeof useProjectLinkMutations>;
const row = (id = "r1"): ProjectLink => ({ id, user_id: "owner", project_id: id, ai_link_id: "link", role: "uses", note: "Original", sort_order: 0, created_at: "2026-10-23T12:00:00Z", updated_at: "2026-10-23T12:00:00Z" });
async function mount() {
  state.write.mockReset(); state.auth.mockResolvedValue("owner"); state.filters = [];
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); qc.setQueryData(qk.projectLinks, [row()]);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const set: Updater<ProjectLink[]> = value => qc.setQueryData(qk.projectLinks, value);
  function Harness() { api = useProjectLinkMutations(set, [row()]); return null; }
  await act(async () => root.render(<QueryClientProvider client={qc}><Harness /></QueryClientProvider>));
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); qc?.clear(); });
it("rolls back only the failed note and retains independent confirmed fields and rows", async () => {
  await mount(); let release!: () => void;
  state.write.mockImplementation(() => new Promise(resolve => { release = () => resolve({ data: null, error: {} }); }));
  let pending!: Promise<boolean>;
  await act(async () => { pending = api.update("r1", { note: "Draft" }); await Promise.resolve(); });
  qc.setQueryData<ProjectLink[]>(qk.projectLinks, rows => [...rows!.map(r => ({ ...r, role: "tool" as const })), row("r2")]);
  await act(async () => { release(); expect(await pending).toBe(false); });
  expect(qc.getQueryData<ProjectLink[]>(qk.projectLinks)).toEqual([{ ...row(), role: "tool" }, row("r2")]);
  expect(state.filters).toContainEqual(["updated_at", row().updated_at]);
});
it("restores failed removals without dropping a newly confirmed row", async () => {
  await mount(); let reject!: (reason: unknown) => void;
  state.write.mockImplementation(() => new Promise((_, r) => { reject = r; })); let pending!: Promise<boolean>;
  await act(async () => { pending = api.remove(["r1"]); await Promise.resolve(); });
  qc.setQueryData(qk.projectLinks, [row("r2")]);
  await act(async () => { reject(new Error("offline")); expect(await pending).toBe(false); });
  expect(qc.getQueryData<ProjectLink[]>(qk.projectLinks)?.map(r => r.id)).toEqual(["r2", "r1"]);
});
it("queues writes and starts the next one from the last confirmed timestamp", async () => {
  await mount(); let release!: () => void;
  state.write.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ data: { ...row(), note: "First", updated_at: "next-version" }, error: null }); }))
    .mockResolvedValue({ data: { ...row(), note: "Second" }, error: null });
  let first!: Promise<boolean>, second!: Promise<boolean>;
  await act(async () => { first = api.update("r1", { note: "First" }); second = api.update("r1", { note: "Second" }); await Promise.resolve(); });
  expect(state.write).toHaveBeenCalledTimes(1);
  await act(async () => { release(); expect(await first).toBe(true); expect(await second).toBe(true); });
  expect(state.filters).toContainEqual(["updated_at", "next-version"]);
  expect(qc.getQueryData<ProjectLink[]>(qk.projectLinks)?.[0].note).toBe("Second");
});
it("retains the cache on malformed nominal upsert success and catches auth rejection", async () => {
  await mount(); state.write.mockResolvedValue({ data: [], error: null });
  await act(async () => { expect(await api.upsert([{ project_id: "p", ai_link_id: "l" }])).toBeNull(); });
  state.auth.mockRejectedValue(new Error("offline"));
  await act(async () => { expect(await api.upsert([{ project_id: "p", ai_link_id: "l" }])).toBeNull(); });
  expect(qc.getQueryData(qk.projectLinks)).toEqual([row()]);
});
it("uses the editor's captured version even when a background read is newer", async () => {
  await mount(); qc.setQueryData(qk.projectLinks, [{ ...row(), updated_at: "background-version" }]);
  state.write.mockResolvedValue({ data: null, error: { code: "PGRST116" } });
  await act(async () => { expect(await api.update("r1", { note: "Draft based on original" }, { expectedUpdatedAt: row().updated_at })).toBe(false); });
  expect(state.filters).toContainEqual(["updated_at", row().updated_at]);
  expect(qc.getQueryData<ProjectLink[]>(qk.projectLinks)?.[0].updated_at).toBe("background-version");
});
