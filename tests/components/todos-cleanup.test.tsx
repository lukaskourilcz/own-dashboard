// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Storage } from "happy-dom";
import { afterEach, expect, it, vi } from "vitest";
import { TodosPanel } from "@/components/panels/todos-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { todos as copy } from "@/lib/i18n/sections/todos";
import type { Todo } from "@/lib/types";
const state = vi.hoisted(() => ({ cleanup: vi.fn(), consume: vi.fn(), ok: vi.fn(), info: vi.fn(), err: vi.fn(), disconnected: vi.fn() }));
vi.mock("@/lib/needed-sync", async load => ({ ...await load<object>(), removeFinishedFromNeeded: (...args: unknown[]) => state.cleanup(...args) }));
vi.mock("@/lib/repository-records", () => ({ consumeRepositoryRecords: (...args: unknown[]) => state.consume(...args) }));
vi.mock("@/lib/github-queries", () => ({ useReposQuery: () => ({ data: { kind: "ok", repos: [] }, isPending: false }), setReposDisconnected: (...args: unknown[]) => state.disconnected(...args) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/use-prefs", () => ({ useTasksPerCategory: () => ({ count: 3 }) }));
vi.mock("@/components/ui/confirmation-dialog", () => ({ useConfirmation: () => async () => true }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ ok: state.ok, info: state.info, err: state.err }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const task = { id: "11111111-1111-4111-8111-111111111111", title: "Finished source task", done: true, source: "github", needed_raw: "- [ ] Finished source task", repo_id: "1", repo_name: "fixture", repo_owner: "owner", due_date: null, importance: null } as Todo;
let root: Root, host: HTMLDivElement, client: QueryClient;
async function run(lang: "en" | "cs") {
  document.documentElement.lang = lang; const storage = new Storage(); storage.setItem("lang", lang); vi.stubGlobal("localStorage", storage);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient();
  await act(async () => { root.render(<QueryClientProvider client={client}><TooltipProvider><TodosPanel todos={[task]} /></TooltipProvider></QueryClientProvider>); });
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === copy[lang].clearFromNeeded)!;
  expect(button).toBeDefined(); await act(async () => { button.click(); });
  await vi.waitFor(() => expect(state.consume).toHaveBeenCalledOnce());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); client?.clear(); vi.unstubAllGlobals(); vi.clearAllMocks(); document.documentElement.lang = "cs"; });
for (const lang of ["en", "cs"] as const) {
  it(`${lang}: incomplete cleanup never reports no finished work or complete success`, async () => {
    state.cleanup.mockResolvedValue({ cleared: [], missing: [], kept: 1, disconnected: false }); state.consume.mockResolvedValue({ deleted: new Set(), retained: new Set() });
    await run(lang); expect(state.ok).not.toHaveBeenCalled(); expect(state.info).not.toHaveBeenCalled(); expect(state.err).toHaveBeenCalledWith(copy[lang].clearFromNeededIncomplete(1));
  });
  it(`${lang}: a reopened local task is retained after its source commit`, async () => {
    state.cleanup.mockResolvedValue({ cleared: [task.id], missing: [], kept: 0, disconnected: false }); state.consume.mockResolvedValue({ deleted: new Set(), retained: new Set([task.id]) });
    await run(lang); expect(state.consume.mock.calls[0][2]).toEqual([task]); expect(state.ok).not.toHaveBeenCalled(); expect(state.info).not.toHaveBeenCalled(); expect(state.err).toHaveBeenCalledWith(copy[lang].clearFromNeededIncomplete(1));
  });
  it(`${lang}: a partial disconnect reports only confirmed local removals`, async () => {
    state.cleanup.mockResolvedValue({ cleared: [task.id], missing: [], kept: 2, disconnected: true }); state.consume.mockResolvedValue({ deleted: new Set([task.id]), retained: new Set() });
    await run(lang); expect(state.ok).toHaveBeenCalledWith(copy[lang].clearFromNeededDone(1)); expect(state.disconnected).toHaveBeenCalledWith(client); expect(state.err).toHaveBeenCalledWith(copy[lang].refreshDisconnected);
  });
}
