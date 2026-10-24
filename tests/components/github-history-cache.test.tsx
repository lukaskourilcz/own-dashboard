// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCrossProjectActivityQuery, useProjectCommitsQuery } from "@/lib/github-queries";
import { qk } from "@/lib/queries/keys";
const commit = { sha: "a".repeat(40), shortSha: "aaaaaaa", message: "Reviewed fixture", author: "fixture", date: "2026-10-24T00:00:00Z", url: `https://github.com/owner/fixture/commit/${"a".repeat(40)}` };
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient;
function View({ activity = false, enabled = true }: { activity?: boolean; enabled?: boolean }) {
  const history = useProjectCommitsQuery("owner/fixture", !activity && enabled), feed = useCrossProjectActivityQuery(activity && enabled);
  const query = activity ? feed : history;
  return <div data-error={query.isError}><output>{JSON.stringify(query.data ?? null)}</output><button onClick={() => void query.refetch()}>Retry</button></div>;
}
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(() => { act(() => root.unmount()); host.remove(); client.clear(); vi.unstubAllGlobals(); });
async function render(view = <View />) { await act(async () => root.render(<QueryClientProvider client={client}>{view}</QueryClientProvider>)); }
async function settle(check: () => void) { await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); check(); }); }
for (const activity of [false, true]) it(`retains confirmed ${activity ? "activity" : "commits"} after a failed refresh`, async () => {
  const cached = activity ? { kind: "ok", items: [], scope: { projects: 0, totalProjects: 0, repositories: 0, unavailableRepositories: 0 } } : { kind: "ok", commits: [commit], codeVolume: null };
  const key = activity ? qk.githubActivity : [...qk.githubCommits, "owner/fixture"]; client.setQueryData(key, cached);
  const fetcher = vi.fn().mockImplementation(async () => new Response(null, { status: 503 })); vi.stubGlobal("fetch", fetcher);
  await render(<View activity={activity} />); act(() => host.querySelector("button")!.click());
  await settle(() => expect(host.querySelector("[data-error]")!.getAttribute("data-error")).toBe("true")); expect(JSON.parse(host.querySelector("output")!.textContent!)).toEqual(cached); expect(fetcher).toHaveBeenCalledOnce();
});
it("does not request either history projection when disabled", async () => { const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); await render(<View enabled={false} />); expect(fetcher).not.toHaveBeenCalled(); });
it("replaces an old history with a confirmed missing repository", async () => {
  client.setQueryData([...qk.githubCommits, "owner/fixture"], { kind: "ok", commits: [commit], codeVolume: null }); vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(null, { status: 404 })));
  await render(); act(() => host.querySelector("button")!.click()); await settle(() => expect(JSON.parse(host.querySelector("output")!.textContent!)).toEqual({ kind: "not-found" }));
});
