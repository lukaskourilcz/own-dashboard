// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bumpRepoInCache, setReposDisconnected, touchRepoInCache, useReposQuery, useWorkspaceRepositories } from "@/lib/github-queries";
import { qk } from "@/lib/queries/keys";
const repo = { id: 123, name: "fixture", full_name: "owner/fixture", owner: "owner", description: null, private: true, fork: false, archived: false, html_url: "https://github.com/owner/fixture", default_branch: "main", language: "TypeScript", stargazers_count: 0, pushed_at: null, updated_at: null };
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient;
function Workspace({ name = repo.full_name, expectedId }: { name?: string; expectedId?: number }) {
  const query = useWorkspaceRepositories(name, expectedId);
  return <div data-error={query.isError} data-pending={query.isPending}><output>{JSON.stringify(query.data ?? null)}</output><button onClick={() => void query.refetch()}>Retry</button></div>;
}
function Catalog() {
  const query = useReposQuery();
  return <div data-error={query.isError}><output>{JSON.stringify(query.data ?? null)}</output><button onClick={() => void query.refetch()}>Retry</button></div>;
}
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(() => { act(() => root.unmount()); host.remove(); client.clear(); vi.unstubAllGlobals(); });
async function render(component = <Workspace />) { await act(async () => root.render(<QueryClientProvider client={client}>{component}</QueryClientProvider>)); }
const snapshot = () => JSON.parse(host.querySelector("output")!.textContent!);
async function settle(check: () => void) { await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); check(); }); }
it("fetches one scoped repository on a cold project visit", async () => {
  const fetcher = vi.fn().mockImplementation(async () => Response.json({ id: 123, full_name: repo.full_name, repo })); vi.stubGlobal("fetch", fetcher);
  await render(); await settle(() => expect(snapshot()).toMatchObject({ kind: "ok", repos: [repo] }));
  expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][0]).toContain("/api/github/repos/lookup?"); expect(client.getQueryData(qk.repos)).toBeUndefined();
});
it("reuses a recently verified catalog entry without another provider request", async () => {
  client.setQueryData(qk.repos, { kind: "ok", repos: [repo], checkedAt: Date.now() }); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await render(); expect(snapshot()).toMatchObject({ kind: "ok", repos: [repo] }); await settle(() => expect(fetcher).not.toHaveBeenCalled());
});
it("resolves an old/renamed project outside the recent page", async () => {
  client.setQueryData(qk.repos, { kind: "ok", repos: [], hasMore: true, checkedAt: Date.now() });
  const renamed = { ...repo, name: "renamed", full_name: "owner/renamed", html_url: "https://github.com/owner/renamed" };
  const fetcher = vi.fn().mockImplementation(async () => Response.json({ id: 123, full_name: renamed.full_name, repo: renamed })); vi.stubGlobal("fetch", fetcher);
  await render(<Workspace name="owner/old-name" />); await settle(() => expect(snapshot()).toMatchObject({ kind: "ok", repos: [renamed] })); expect(fetcher).toHaveBeenCalledOnce();
});
it("retains confirmed catalog data when a refresh fails instead of saving an empty/error result", async () => {
  client.setQueryData(qk.repos, { kind: "ok", repos: [repo], checkedAt: Date.now() }); vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(null, { status: 503 })));
  await render(<Catalog />); act(() => host.querySelector("button")!.click());
  await settle(() => expect(host.querySelector("[data-error]")!.getAttribute("data-error")).toBe("true")); expect(snapshot()).toMatchObject({ kind: "ok", repos: [repo] });
});
it("keeps a scoped cached read on 503 but distinguishes a confirmed invisible repository", async () => {
  client.setQueryData([...qk.githubRepo, repo.full_name], { kind: "ok", repo, checkedAt: Date.now() });
  let status = 503; vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(null, { status })));
  await render(); act(() => host.querySelector("button")!.click()); await settle(() => expect(host.querySelector("[data-error]")!.getAttribute("data-error")).toBe("true")); expect(snapshot()).toMatchObject({ kind: "ok", repos: [repo] });
  status = 404; act(() => host.querySelector("button")!.click()); await settle(() => expect(snapshot()).toMatchObject({ kind: "not-found" }));
});
it("does not promote an older catalog after another row's push-time cache update", async () => {
  const other = { ...repo, id: 456, name: "other", full_name: "owner/other", html_url: "https://github.com/owner/other" };
  const renamed = { ...repo, name: "renamed", full_name: "owner/renamed", html_url: "https://github.com/owner/renamed" };
  const oldClock = Date.now() - 1000, latestClock = Date.now();
  client.setQueryData(qk.repos, { kind: "ok", repos: [repo, other], checkedAt: oldClock }); client.setQueryData([...qk.githubRepo, repo.full_name], { kind: "ok", repo: renamed, checkedAt: latestClock });
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); await render(); act(() => touchRepoInCache(client, 456));
  await settle(() => expect(snapshot()).toMatchObject({ kind: "ok", repos: [renamed] })); expect(client.getQueryData(qk.repos)).toMatchObject({ checkedAt: oldClock });
  act(() => bumpRepoInCache(client, 123)); await settle(() => expect(snapshot().repos[0]).toMatchObject({ name: "renamed", pushed_at: expect.any(String) })); expect(client.getQueryData([...qk.githubRepo, repo.full_name])).toMatchObject({ checkedAt: latestClock }); expect(fetcher).not.toHaveBeenCalled();
});
it("cancels late scoped reads on disconnect and preserves owned notes/links", async () => {
  const stop = vi.fn(), response = new Response(new ReadableStream({ cancel: stop })); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  const owned = [{ id: "owned-fixture", body: "Local note" }]; client.setQueryData(qk.repoNotes, owned); client.setQueryData(qk.repoLinks, owned);
  await render(); await settle(() => expect(response.body!.locked).toBe(true)); await act(async () => setReposDisconnected(client));
  await settle(() => expect(snapshot()).toMatchObject({ kind: "disconnected" })); expect(stop).toHaveBeenCalledOnce(); expect(client.getQueryData(qk.repoNotes)).toEqual(owned); expect(client.getQueryData(qk.repoLinks)).toEqual(owned);
});

it("does not present old scoped metadata as connected after the shared catalog loses access", async () => {
  client.setQueryData([...qk.githubRepo, repo.full_name], { kind: "ok", repo, checkedAt: Date.now() });
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); await render();
  expect(snapshot()).toMatchObject({ kind: "ok" });
  act(() => client.setQueryData(qk.repos, { kind: "disconnected", checkedAt: Date.now() }));
  await settle(() => expect(snapshot()).toMatchObject({ kind: "disconnected" })); expect(fetcher).not.toHaveBeenCalled();
});

it("reuses a renamed catalog identity by the linked id rather than a now-stale name", async () => {
  const renamed = { ...repo, full_name: "owner/renamed", name: "renamed", html_url: "https://github.com/owner/renamed" };
  client.setQueryData(qk.repos, { kind: "ok", repos: [renamed], checkedAt: Date.now() }); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await render(<Workspace expectedId={123} />); expect(snapshot()).toMatchObject({ kind: "ok", repos: [renamed] }); expect(fetcher).not.toHaveBeenCalled();
});
it("does not reuse another repository occupying the same catalog name", async () => {
  const reused = { ...repo, id: 456 }; client.setQueryData(qk.repos, { kind: "ok", repos: [reused], checkedAt: Date.now() });
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ id: 456, full_name: reused.full_name, repo: reused })));
  await render(<Workspace expectedId={123} />); await settle(() => expect(snapshot()).toMatchObject({ kind: "not-found" }));
});

it("does not mark a later account's cache disconnected after an older cancellation finishes", async () => {
 let release!: () => void, current = true;
 const cancel = vi.spyOn(client, 'cancelQueries').mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
 client.setQueryData(qk.repos, { kind: 'ok', repos: [repo] });
 const pending = setReposDisconnected(client, () => current); expect(cancel).toHaveBeenCalledOnce();
 current = false; const later = { kind: 'ok', repos: [{ ...repo, id: 456 }] }; client.setQueryData(qk.repos, later); release(); await pending;
 expect(client.getQueryData(qk.repos)).toEqual(later);
 await setReposDisconnected(client, () => false); expect(cancel).toHaveBeenCalledOnce();
});
