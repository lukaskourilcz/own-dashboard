// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Storage } from "happy-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ refetch: vi.fn(), read: vi.fn(), scan: vi.fn(), sync: vi.fn(), ok: vi.fn(), info: vi.fn(), err: vi.fn() }));
vi.mock("@/lib/github-queries", () => ({ useReposQuery: () => ({ data: { kind: "ok", repos: [{ id: 999 }] }, isPending: false, refetch: state.refetch }), setReposDisconnected: vi.fn() }));
vi.mock("@/lib/owned-records", () => ({ readOwnedCollection: state.read }));
vi.mock("@/lib/needed-sync", async load => ({ ...await load<object>(), scanNeededRepos: state.scan }));
vi.mock("@/lib/needed-task-store", () => ({ syncNeededTasks: state.sync }));
vi.mock("@/lib/supabase/user", () => ({ currentUserId: async () => "owner" }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/use-prefs", () => ({ useTasksPerCategory: () => ({ count: 3 }) }));
vi.mock("@/components/ui/confirmation-dialog", () => ({ useConfirmation: () => async () => true }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ ok: state.ok, info: state.info, err: state.err }) }));
import { TodosPanel } from "@/components/panels/todos-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { todos } from "@/lib/i18n/sections/todos";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks(); state.refetch.mockResolvedValue({ isError: false, data: { kind: "ok", repos: [], hasMore: false } });
  state.read.mockResolvedValue({ data: [], error: null }); state.scan.mockResolvedValue({ scanned: new Set(), freshRows: [], missing: [], unavailable: [] }); state.sync.mockResolvedValue({ added: 0, removed: 0, retained: 0 });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true })));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient();
});
afterEach(() => { act(() => root.unmount()); host.remove(); client.clear(); vi.unstubAllGlobals(); document.documentElement.lang = "cs"; });
async function refresh(lang: "en" | "cs") {
  const storage = new Storage(); storage.setItem("lang", lang); vi.stubGlobal("localStorage", storage); document.documentElement.lang = lang;
  await act(async () => root.render(<QueryClientProvider client={client}><TooltipProvider><TodosPanel ownerId="owner" todos={[]} /></TooltipProvider></QueryClientProvider>));
  act(() => [...host.querySelectorAll("button")].find(button => button.textContent?.trim() === todos[lang].refresh)!.click());
  await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); expect(state.refetch).toHaveBeenCalledOnce(); });
}
for (const lang of ["en", "cs"] as const) {
  it(`${lang}: a failed catalog refresh never starts mutations from its stale cached list`, async () => {
    state.refetch.mockResolvedValue({ isError: true, data: { kind: "ok", repos: [{ id: 999 }] } });
    await refresh(lang); await vi.waitFor(() => expect(state.err).toHaveBeenCalled()); expect(state.read).not.toHaveBeenCalled(); expect(state.scan).not.toHaveBeenCalled(); expect(state.sync).not.toHaveBeenCalled(); expect(state.ok).not.toHaveBeenCalled();
  });
  it(`${lang}: a capped repository page never reports every task up to date`, async () => {
    state.refetch.mockResolvedValue({ isError: false, data: { kind: "ok", repos: [{ id: 123 }], hasMore: true } });
    await refresh(lang); await vi.waitFor(() => expect(state.info).toHaveBeenCalledWith(todos[lang].refreshRepoLimit(1))); expect(state.scan.mock.calls[0][1]).toEqual([{ id: 123 }]); expect(state.ok).not.toHaveBeenCalledWith(todos[lang].refreshNothing);
  });
}
