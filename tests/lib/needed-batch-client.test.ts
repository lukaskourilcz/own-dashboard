import { afterEach, expect, it, vi } from "vitest";
import { loadNeededBatch, neededBatchQueryKey } from "@/lib/needed-batch-client";
import { scanNeededRepos } from "@/lib/needed-sync";
import type { GithubRepo } from "@/lib/github";
const repos = [{ id: 1, owner: "owner", name: "fixture", full_name: "owner/fixture" }] as GithubRepo[];
const result = { kind: "ok", files: [{ repoId: "1", result: { kind: "ok", path: "NEEDED.md", sha: "a".repeat(40), content: "- [ ] Actual task", htmlUrl: "https://github.com/owner/fixture/blob/main/NEEDED.md" } }] };
afterEach(() => vi.unstubAllGlobals());
it("sends one metadata-only request and validates its complete file identities", async () => {
  const fetcher = vi.fn(async (url: string, input?: RequestInit) => { expect(url).toBe("/api/github/needed"); expect(JSON.parse(input!.body as string)).toEqual({ repos: [{ id: 1, owner: "owner", name: "fixture" }] }); return Response.json(result); }); vi.stubGlobal("fetch", fetcher);
  expect(await loadNeededBatch(repos)).toEqual(result); expect(fetcher).toHaveBeenCalledOnce();
});
it.each([{ kind: "ok", files: [] }, { kind: "ok", files: [result.files[0], result.files[0]] }, { kind: "ok", files: [{ ...result.files[0], repoId: "2" }] }, { kind: "ok", files: [{ repoId: "1", result: { ...result.files[0].result, sha: "bad" } }] }, { kind: "ok", files: [{ repoId: "1", result: { ...result.files[0].result, htmlUrl: "https://other.example/private" } }] }])("keeps malformed, capped or foreign success bodies unavailable", async body => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(body)));
  expect(await loadNeededBatch(repos)).toEqual({ kind: "ok", files: [{ repoId: "1", result: { kind: "error" } }] });
});
it.each([401, 429, 503])("distinguishes a %s response without trusting its private body", async status => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ private: "invented-fixture" }, { status })));
  expect(await loadNeededBatch(repos)).toEqual(status === 401 ? { kind: "disconnected" } : { kind: "ok", files: [{ repoId: "1", result: { kind: "error" } }] });
});
it("skips empty/invalid work before a provider request", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect(await loadNeededBatch([])).toEqual({ kind: "ok", files: [] }); await loadNeededBatch([repos[0], repos[0]]); expect(fetcher).not.toHaveBeenCalled();
});
it("propagates caller cancellation without accepting a late success as cache data", async () => {
  const controller = new AbortController(); let release!: (reply: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(resolve => { release = resolve; })); vi.stubGlobal("fetch", fetcher);
  const pending = loadNeededBatch(repos, controller.signal);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce()); controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" }); release(Response.json(result));
});
it("uses the shared batch path for task refresh and reports every unread source", async () => {
  const fetcher = vi.fn(async () => Response.json({ kind: "ok", files: [result.files[0], { repoId: "2", result: { kind: "error" } }] })); vi.stubGlobal("fetch", fetcher);
  const scan = await scanNeededRepos("owner", [repos[0], { ...repos[0], id: 2, name: "unavailable", full_name: "owner/unavailable" }], "2026-10-24T05:00:00Z");
  expect([...scan.scanned]).toEqual(["1"]); expect(scan.freshRows).toHaveLength(1); expect(scan.unavailable).toEqual(["owner/unavailable"]); expect(fetcher).toHaveBeenCalledOnce();
});

it("reuses the same file cache when repository activity changes the list order", () => {
  const second = { ...repos[0], id: 2, name: "second" };
  expect(neededBatchQueryKey([repos[0], second])).toEqual(neededBatchQueryKey([second, repos[0]]));
});
