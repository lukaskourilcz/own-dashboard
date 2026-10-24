// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Storage } from "happy-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { ReposPanel } from "@/components/panels/repos-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { qk } from "@/lib/queries/keys";
import { github } from "@/lib/i18n/sections/github";
import type { GithubRepo } from "@/lib/github";
const state = vi.hoisted(() => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => state }));
vi.mock("@/components/ui/confirmation-dialog", () => ({ useConfirmation: () => async () => true }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, host: HTMLDivElement, client: QueryClient;
afterEach(() => { act(() => root?.unmount()); host?.remove(); client?.clear(); vi.unstubAllGlobals(); state.ok.mockReset(); state.info.mockReset(); state.err.mockReset(); document.documentElement.lang = "cs"; });
const repo: GithubRepo = { id: 123, name: "fixture", full_name: "owner/fixture", owner: "owner", description: null, private: true, fork: false, archived: false, html_url: "https://github.com/owner/fixture", default_branch: "main", language: "TypeScript", stargazers_count: 0, pushed_at: null, updated_at: null };
async function render() {
  vi.stubGlobal("localStorage", new Storage()); document.documentElement.lang = "en";
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(qk.repos, { kind: "ok", repos: [repo] });
  await act(async () => root!.render(<QueryClientProvider client={client}><TooltipProvider><ReposPanel initialVisibleIds={[]} repoNotes={[]} setRepoNotes={() => undefined} repoLinks={[]} setRepoLinks={() => undefined} /></TooltipProvider></QueryClientProvider>));
}
async function disconnect() {
  const button = [...host.querySelectorAll("button")].find(button => button.textContent?.trim() === github.en.disconnect)!;
  await act(async () => { button.click(); await new Promise(resolve => setTimeout(resolve, 30)); });
}
it.each([true, false])("distinguishes upstream revocation from local-only removal (%s)", async upstreamRevoked => {
  const fetcher = vi.fn(async () => Response.json({ ok: true, upstreamRevoked })); vi.stubGlobal("fetch", fetcher); await render(); await disconnect();
  expect(client.getQueryData(qk.repos)).toEqual({ kind: "disconnected" });
  if (upstreamRevoked) expect(state.ok).toHaveBeenCalledWith(github.en.disconnectOk); else expect(state.info).toHaveBeenCalledWith(github.en.disconnectLocalOnly);
  expect(fetcher).toHaveBeenCalledOnce();
});
it("retains the connected view after an unconfirmed removal receipt", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true })));
  await render(); await disconnect(); expect(client.getQueryData(qk.repos)).toMatchObject({ kind: "ok" }); expect(state.err).toHaveBeenCalledWith(github.en.disconnectErr);
});
