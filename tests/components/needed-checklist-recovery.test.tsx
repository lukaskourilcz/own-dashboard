// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Storage } from "happy-dom";
import { afterEach, expect, it, vi } from "vitest";
import { NeededChecklist } from "@/components/panels/needed-checklist";
import { TooltipProvider } from "@/components/ui/tooltip";
import { common } from "@/lib/i18n/sections/common";
import { github } from "@/lib/i18n/sections/github";
import type { GithubRepo } from "@/lib/github";
import type { NeededFileResult } from "@/lib/needed";
import { neededBatchQueryKey } from "@/lib/needed-batch-client";
const state = vi.hoisted(() => ({ load: vi.fn(), rpc: vi.fn(), commit: vi.fn(), ok: vi.fn(), err: vi.fn() }));
vi.mock("@/lib/needed-batch-client", async load => ({ ...await load<object>(), loadNeededBatch: async () => ({ kind: "ok", files: [{ repoId: "123", result: await state.load() }] }) }));
vi.mock("@/lib/needed", async load => ({ ...await load<object>(), loadNeededFile: (...args: unknown[]) => state.load(...args) }));
vi.mock("@/lib/github", async load => ({ ...await load<object>(), commitFile: (...args: unknown[]) => state.commit(...args) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: (...args: unknown[]) => ({ abortSignal: () => state.rpc(...args) }) }) }));
vi.mock("@/lib/supabase/user", () => ({ currentUserId: async () => "11111111-1111-4111-8111-111111111111" }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ ok: state.ok, err: state.err }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const repo = { id: 123, owner: "owner", name: "fixture", full_name: "owner/fixture", html_url: "https://github.com/owner/fixture" } as GithubRepo;
const file = (content: string): NeededFileResult => ({ kind: "ok", content, htmlUrl: "https://github.com/owner/fixture/blob/main/NEEDED.md", sha: "a".repeat(40), path: "NEEDED.md" });
let root: Root, host: HTMLDivElement, client: QueryClient;
async function mount() {
  document.documentElement.lang = "en"; vi.stubGlobal("localStorage", new Storage());
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root.render(<QueryClientProvider client={client}><TooltipProvider><NeededChecklist repos={[repo]}/></TooltipProvider></QueryClientProvider>); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); client?.clear(); vi.unstubAllGlobals(); vi.clearAllMocks(); document.documentElement.lang = "cs"; });
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === label)!;
it.each(["error", "not-found"] as const)("does not announce all clear for an unavailable %s source and retries it", async kind => {
  state.load.mockResolvedValue({ kind }); await mount();
  expect(host.textContent).not.toContain(github.en.needed.allClear); expect(host.textContent).toContain(github.en.needed.unavailable(repo.full_name));
  state.load.mockResolvedValue(file("")); await act(async () => { button(common.en.retry).click(); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(host.textContent).toContain(github.en.needed.allClear);
});
it("imports only the displayed actionable rows through the atomic receipt", async () => {
  state.load.mockResolvedValue(file("- [ ] Actual task\n  [owner:ai]\n- [x] Finished task\n- Explanatory note"));
  state.rpc.mockImplementation(async (_name, input) => ({ data: { inserted: input.p_rows.map((row: object) => ({ ...row, id: "33333333-3333-4333-8333-333333333333" })), deleted_ids: [], retained_ids: [] }, error: null }));
  await mount(); expect(host.textContent).toContain("Actual task"); expect(host.textContent).not.toContain("Explanatory note");
  await act(async () => { button(github.en.needed.createTodos).click(); await vi.waitFor(() => expect(state.ok).toHaveBeenCalled()); });
  expect(state.rpc).toHaveBeenCalledOnce(); expect(state.rpc.mock.calls[0][1].p_rows).toHaveLength(1); expect(state.rpc.mock.calls[0][1].p_rows[0].needed_assignee).toBe("ai");
});
it("retains the action list after an unconfirmed import", async () => {
  state.load.mockResolvedValue(file("- [ ] Actual task")); state.rpc.mockResolvedValue({ data: {}, error: null }); await mount();
  await act(async () => { button(github.en.needed.createTodos).click(); await vi.waitFor(() => expect(state.err).toHaveBeenCalled()); });
  expect(state.ok).not.toHaveBeenCalled(); expect(host.textContent).toContain("Actual task"); expect(button(github.en.needed.createTodos).disabled).toBe(false);
});
it("refreshes a conflicted file once and presents its version conflict", async () => {
  state.load.mockResolvedValue(file("- [ ] Actual task")); state.commit.mockResolvedValue({ ok: false, status: 409, error: "conflict" }); await mount();
  await act(async () => { host.querySelector<HTMLButtonElement>(`button[aria-label="${github.en.needed.checkOff}: Actual task"]`)!.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(state.err).toHaveBeenCalledWith(github.en.fileChanged); expect(state.load).toHaveBeenCalledTimes(2); expect(state.commit.mock.calls[0][0]).toMatchObject({ intent: "edit", expectedSha: "a".repeat(40) });
});
it("updates a confirmed check-off from its receipt without another source read", async () => {
  state.load.mockResolvedValue(file("- [ ] Actual task\n- [ ] Second task"));
  state.commit.mockResolvedValue({ ok: true, result: { path: "NEEDED.md", updated: true, unchanged: false, commit: { sha: "b".repeat(40), html_url: "https://github.com/owner/fixture/commit/fixture" }, content: { sha: "c".repeat(40), html_url: "https://github.com/owner/fixture/blob/main/NEEDED.md" } } }); await mount();
  await act(async () => { host.querySelector<HTMLButtonElement>(`button[aria-label="${github.en.needed.checkOff}: Actual task"]`)!.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(state.ok).toHaveBeenCalled(); expect(state.load).toHaveBeenCalledOnce(); expect(host.textContent).not.toContain("Actual task"); expect(host.textContent).toContain("Second task");
  expect(client.getQueryData(neededBatchQueryKey([repo]))).toMatchObject({ kind: "ok", files: [{ result: { content: "- [ ] Second task", sha: "c".repeat(40) } }] });
});
it("does not replace a disconnected cache with a late manual retry", async () => {
  state.load.mockResolvedValue({ kind: "error" }); await mount(); let release!: (value: NeededFileResult) => void;
  state.load.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => { button(common.en.retry).click(); });
  await act(async () => { client.setQueryData(neededBatchQueryKey([repo]), { kind: "disconnected" }); });
  await act(async () => { release(file("- [ ] Late source")); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(client.getQueryData(neededBatchQueryKey([repo]))).toEqual({ kind: "disconnected" }); expect(host.textContent).not.toContain("Late source");
});
