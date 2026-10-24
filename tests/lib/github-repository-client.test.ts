import { afterEach, expect, it, vi } from "vitest";
import { loadRepositoryResult, loadReposResult, lookupRepoIdentity } from "@/lib/github";
const repo = { id: 123, name: "fixture", full_name: "owner/fixture", owner: "owner", description: null, private: true, fork: false, archived: false, html_url: "https://github.com/owner/fixture", default_branch: "main", language: "TypeScript", stargazers_count: 0, pushed_at: null, updated_at: null };
afterEach(() => vi.unstubAllGlobals());
it("validates recent metadata and propagates its explicit page boundary", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ repos: [repo], hasMore: true })); vi.stubGlobal("fetch", fetcher);
  expect(await loadReposResult()).toMatchObject({ kind: "ok", repos: [repo], hasMore: true, checkedAt: expect.any(Number) }); expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: "no-store", signal: expect.any(AbortSignal) });
});
it.each([{ ...repo, owner: "foreign" }, { ...repo, html_url: "https://unsafe.example.test/" }, { ...repo, name: "different-target" }, { ...repo, pushed_at: "invalid" }, { ...repo, id: 9007199254740992 }])("does not cast a malformed successful row into the cache (%j)", async row => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ repos: [row] }))); expect(await loadReposResult()).toEqual({ kind: "error" });
});
it("supports bounded complete pages even with long metadata", async () => {
  const repos = Array.from({ length: 100 }, (_, i) => ({ ...repo, id: i + 1, name: `repo-${i}`, full_name: `owner/repo-${i}`, html_url: `https://github.com/owner/repo-${i}`, description: "x".repeat(4096) }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ repos, hasMore: false }))); expect(await loadReposResult()).toMatchObject({ kind: "ok", repos });
});
it.each([401, 404, 503])("keeps denied and unavailable responses distinct (%s)", async status => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(null, { status })));
  expect(await loadReposResult()).toMatchObject({ kind: status === 401 ? "disconnected" : "error" });
  expect(await loadRepositoryResult("owner/fixture")).toMatchObject({ kind: status === 401 ? "disconnected" : status === 404 ? "not-found" : "error" });
});
it("uses a canonical renamed lookup without downloading the recent catalog", async () => {
  const renamed = { ...repo, name: "renamed", full_name: "owner/renamed", html_url: "https://github.com/owner/renamed" };
  const fetcher = vi.fn().mockImplementation(async () => Response.json({ id: 123, full_name: renamed.full_name, repo: renamed })); vi.stubGlobal("fetch", fetcher);
  expect(await loadRepositoryResult("owner/old-name")).toMatchObject({ kind: "ok", repo: renamed }); expect(await lookupRepoIdentity("owner/old-name")).toEqual({ id: 123, full_name: renamed.full_name });
  expect(fetcher.mock.calls.every(call => call[0].startsWith("/api/github/repos/lookup?"))).toBe(true);
});
it("rejects mismatched lookup identities or invalid paths", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ id: 456, full_name: repo.full_name, repo })); vi.stubGlobal("fetch", fetcher);
  expect(await loadRepositoryResult(repo.full_name)).toEqual({ kind: "error" }); fetcher.mockClear(); expect(await loadRepositoryResult("owner/../unexpected")).toEqual({ kind: "error" }); expect(fetcher).not.toHaveBeenCalled();
});
it("cancels a stalled response body and does not expose a reason", async () => {
  const cancel = vi.fn(), stop = new AbortController(), response = new Response(new ReadableStream({ cancel })); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  const pending = loadReposResult({ signal: stop.signal }); await vi.waitFor(() => expect(response.body!.locked).toBe(true)); stop.abort("PRIVATE"); expect(await pending).toEqual({ kind: "error" }); expect(cancel).toHaveBeenCalledOnce();
});

it("refuses a reused name whose current repository id differs from the linked project", async () => {
  const fetcher = vi.fn().mockImplementation(async () => Response.json({ id: repo.id, full_name: repo.full_name, repo })); vi.stubGlobal("fetch", fetcher);
  expect(await loadRepositoryResult(repo.full_name, undefined, 456)).toMatchObject({ kind: "not-found" });
  fetcher.mockClear(); expect(await loadRepositoryResult(repo.full_name, undefined, Number.MAX_SAFE_INTEGER + 1)).toEqual({ kind: "error" }); expect(fetcher).not.toHaveBeenCalled();
});
