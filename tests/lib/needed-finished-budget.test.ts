import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { removeFinishedFromNeeded, type NeededCommit } from "@/lib/needed-sync";
import { loadNeededBatch } from "@/lib/needed-batch-client";
import type { NeededFileResult } from "@/lib/needed";
import type { Todo } from "@/lib/types";

vi.mock("@/lib/needed-batch-client", () => ({ loadNeededBatch: vi.fn() }));
const file = { kind: "ok", path: "NEEDED.md", sha: "a".repeat(40), content: "# Work\n- [ ] Finished\n", htmlUrl: null } satisfies NeededFileResult;
const success = { ok: true, result: { path: "NEEDED.md", updated: true, unchanged: false, commit: { sha: "b".repeat(40), html_url: "https://github.com/owner/fixture/commit/example" }, content: { sha: "c".repeat(40), html_url: "https://github.com/owner/fixture/blob/main/NEEDED.md" } } } as const;
function task(id: number): Todo {
  return { id: `task-${id}`, source: "github", done: true, repo_id: String(id), repo_owner: "owner", repo_name: `repo-${id}`, needed_raw: "- [ ] Finished" } as Todo;
}
beforeEach(() => { vi.mocked(loadNeededBatch).mockReset(); });
afterEach(() => vi.restoreAllMocks());

it("reads the selected sources in one batch before versioned writes", async () => {
  vi.mocked(loadNeededBatch).mockResolvedValue({ kind: "ok", files: [1, 2].map(id => ({ repoId: String(id), result: file })) });
  const commit = vi.fn<NeededCommit>(async (input, signal) => {
    expect(loadNeededBatch).toHaveBeenCalledOnce(); expect(signal?.aborted).toBe(false);
    expect(input).toMatchObject({ expectedSha: file.sha, content: "# Work\n", count: 1 });
    return success;
  });
  expect(await removeFinishedFromNeeded([task(1), task(2)], commit)).toEqual({ cleared: ["task-1", "task-2"], missing: [], kept: 0, disconnected: false });
  expect(loadNeededBatch).toHaveBeenCalledWith([{ id: 1, owner: "owner", name: "repo-1" }, { id: 2, owner: "owner", name: "repo-2" }], expect.any(AbortSignal));
  expect(commit).toHaveBeenCalledTimes(2);
});

it("keeps the unconfirmed remainder when cancellation follows one saved source", async () => {
  const controller = new AbortController(); let finish!: (value: typeof success) => void;
  const commit = vi.fn<NeededCommit>(async input => input.repo === "repo-1" ? success : new Promise(resolve => { finish = resolve; }));
  const pending = removeFinishedFromNeeded([task(1), task(2), task(3)], commit, async () => file, { signal: controller.signal });
  await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(2)); controller.abort();
  expect(await pending).toEqual({ cleared: ["task-1"], missing: [], kept: 2, disconnected: false });
  expect(commit.mock.calls[1][1]?.aborted).toBe(true); finish(success);
  await Promise.resolve(); expect(commit).toHaveBeenCalledTimes(2);
});

it("applies the total cleanup deadline even when a source loader ignores cancellation", async () => {
  const deadline = new AbortController(); const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  const load = vi.fn(() => new Promise<NeededFileResult>(() => {})); const commit = vi.fn<NeededCommit>();
  const pending = removeFinishedFromNeeded([task(1)], commit, load);
  expect(timeout).toHaveBeenCalledWith(60_000); expect(load).toHaveBeenCalledOnce(); deadline.abort();
  expect(await pending).toEqual({ cleared: [], missing: [], kept: 1, disconnected: false }); expect(commit).not.toHaveBeenCalled();
});

it("does no source read or write after an already-aborted caller", async () => {
  const controller = new AbortController(); controller.abort(); const load = vi.fn(); const commit = vi.fn<NeededCommit>();
  expect(await removeFinishedFromNeeded([task(1)], commit, load, { signal: controller.signal })).toMatchObject({ cleared: [], kept: 1 });
  expect(load).not.toHaveBeenCalled(); expect(loadNeededBatch).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
});

it("retains earlier confirmations and stops new writes after disconnection", async () => {
  const commit = vi.fn<NeededCommit>(async input => input.repo === "repo-1" ? success : { ok: false, status: 401, error: "commit-unconfirmed" });
  expect(await removeFinishedFromNeeded([task(1), task(2), task(3)], commit, async () => file)).toEqual({ cleared: ["task-1"], missing: [], kept: 2, disconnected: true });
  expect(commit).toHaveBeenCalledTimes(2);
});

it("bounds source groups and reports the remaining eligible work", async () => {
  vi.mocked(loadNeededBatch).mockImplementation(async repos => ({ kind: "ok", files: repos.map(repo => ({ repoId: String(repo.id), result: { kind: "not-found" } })) }));
  const tasks = Array.from({ length: 101 }, (_, index) => task(index + 1)); const commit = vi.fn<NeededCommit>();
  const result = await removeFinishedFromNeeded([...tasks, { ...task(102), source: null }, { ...task(103), done: false }], commit);
  expect(result.cleared).toHaveLength(100); expect(result.missing).toHaveLength(100); expect(result.kept).toBe(1);
  expect(vi.mocked(loadNeededBatch).mock.calls[0][0]).toHaveLength(100); expect(commit).not.toHaveBeenCalled();
});

it("uses the actual number of removed lines for a duplicated legacy task", async () => {
  const commit = vi.fn<NeededCommit>(async () => success);
  const result = await removeFinishedFromNeeded([task(1), { ...task(1), id: "duplicate" }], commit, async () => file);
  expect(commit.mock.calls[0][0].count).toBe(1); expect(result.cleared).toEqual(["task-1", "duplicate"]);
});
