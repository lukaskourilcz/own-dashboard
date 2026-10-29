import { afterEach, expect, it, vi } from "vitest";
import { loadCrossProjectActivity, loadProjectCommits } from "@/lib/github";
const commit = { sha: "a".repeat(40), shortSha: "aaaaaaa", message: "Reviewed fixture", author: "fixture-user", date: "2026-10-24T00:00:00Z", url: `https://github.com/owner/fixture/commit/${"a".repeat(40)}` };
const item = { ...commit, repo: "owner/fixture", projectId: "33333333-3333-4333-8333-333333333333", projectName: "Fixture", projectSlug: "fixture" };
const scope = { projects: 10, totalProjects: 15, repositories: 3, unavailableRepositories: 1 };
afterEach(() => vi.unstubAllGlobals());
it("validates commit history and propagates request cancellation with uncached reads", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ commits: [commit], codeVolume: { additions: 0, deletions: 0, weeks: 1 } })); vi.stubGlobal("fetch", fetcher);
  expect(await loadProjectCommits("owner/fixture")).toEqual({ kind: "ok", commits: [commit], codeVolume: { additions: 0, deletions: 0, weeks: 1 } }); expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: "no-store", signal: expect.any(AbortSignal) });
});
it("validates the explicit partial activity scope instead of discarding it", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ connected: true, items: [item], scope }))); expect(await loadCrossProjectActivity()).toEqual({ kind: "ok", items: [item], scope });
});
it.each([401, 404, 503])("keeps denied, missing and failed history distinct (%s)", async status => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(null, { status })));
  expect(await loadProjectCommits("owner/fixture")).toEqual({ kind: status === 401 ? "disconnected" : status === 404 ? "not-found" : "error" });
  expect(await loadCrossProjectActivity()).toEqual({ kind: status === 401 ? "disconnected" : "error" });
});
it.each([{ ...commit, sha: "invalid" }, { ...commit, shortSha: "wrong" }, { ...commit, url: "javascript:alert(1)" }, { ...commit, date: "invalid" }])("refuses malformed successful commit history (%j)", async row => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ commits: [row], codeVolume: null }))); expect(await loadProjectCommits("owner/fixture")).toEqual({ kind: "error" });
});
it.each([{ ...scope, unavailableRepositories: 4 }, { ...scope, projects: 16 }, { ...scope, repositories: 3, unavailableRepositories: 3 }, { projects: 0, totalProjects: 0, repositories: 0, unavailableRepositories: 0 }, undefined])("refuses missing or contradictory activity scope (%j)", async scope => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ connected: true, items: [item], scope }))); expect(await loadCrossProjectActivity()).toEqual({ kind: "error" });
});
it("refuses duplicate feed entries but accepts a confirmed disconnected envelope", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ connected: true, items: [item, item], scope })).mockResolvedValueOnce(Response.json({ connected: false, items: [] })));
  expect(await loadCrossProjectActivity()).toEqual({ kind: "error" }); expect(await loadCrossProjectActivity()).toEqual({ kind: "disconnected" });
});
it("rejects invalid paths before issuing a request", async () => { const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); expect(await loadProjectCommits("owner/../other")).toEqual({ kind: "error" }); expect(fetcher).not.toHaveBeenCalled(); });
it("cancels stalled activity bodies and releases the stream", async () => {
  const stop = new AbortController(), cancel = vi.fn(), response = new Response(new ReadableStream({ cancel })); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  const pending = loadCrossProjectActivity(stop.signal); await vi.waitFor(() => expect(response.body!.locked).toBe(true)); stop.abort("PRIVATE"); expect(await pending).toEqual({ kind: "error" }); expect(cancel).toHaveBeenCalledOnce();
});
