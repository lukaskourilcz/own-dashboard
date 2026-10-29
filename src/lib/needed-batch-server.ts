import "server-only";
import { readRepositoryFileSnapshot } from "@/lib/github-repository-file-server";
import { readGithubTextFile } from "@/lib/github-file-server";
import { NEEDED_FILE_PATHS } from "@/lib/needed-paths";
import type { NeededBatchRepository, NeededBatchResult } from "@/lib/needed-batch-contract";

/** One request-scoped provider context, four active repository reads and a
 * total serialized-result bound. Failed/unstarted sources remain unavailable. */
export async function readNeededBatch(repos: NeededBatchRepository[], fetcher: (path: string) => Promise<Response>, parent: AbortSignal, maximumBytes = 8 * 1024 * 1024): Promise<NeededBatchResult> {
  const controller = new AbortController(), signal = AbortSignal.any([parent, controller.signal]);
  const files: Extract<NeededBatchResult, { kind: "ok" }>["files"] = repos.map(repo => ({ repoId: String(repo.id), result: { kind: "error" } }));
  let cursor = 0, bytes = Buffer.byteLength(JSON.stringify({ kind: "ok", files }), "utf8"), disconnected = false;
  if (bytes > maximumBytes) throw Error("Repository result bound too small");
  function assign(index: number, result: (typeof files)[number]["result"]) {
    const next = { ...files[index], result };
    const total = bytes + Buffer.byteLength(JSON.stringify(next), "utf8") - Buffer.byteLength(JSON.stringify(files[index]), "utf8");
    if (total > maximumBytes) { controller.abort(); return; }
    bytes = total; files[index] = next;
  }
  async function worker() {
    while (cursor < repos.length && !signal.aborted) {
      const index = cursor++, repo = repos[index];
      try {
        const snapshot = await readRepositoryFileSnapshot(fetcher, { owner: repo.owner, repo: repo.name, expectedRepositoryId: repo.id, path: NEEDED_FILE_PATHS[0], fallback: NEEDED_FILE_PATHS[1] }, signal);
        const source = snapshot.branch.target.primary ?? snapshot.branch.target.secondary;
        if (!source) { assign(index, { kind: "not-found" }); continue; }
        const [owner, name] = snapshot.nameWithOwner.split("/");
        const path = source.path as (typeof NEEDED_FILE_PATHS)[number];
        const read = await readGithubTextFile(fetcher, owner, name, path, signal, snapshot.branch.target.oid);
        if (!read.ok) { if (read.status === 401) { disconnected = true; controller.abort(); } continue; }
        if (signal.aborted || read.file.sha !== source.oid || Buffer.byteLength(read.file.content, "utf8") !== source.size) continue;
        assign(index, { kind: "ok", path, content: read.file.content, sha: read.file.sha, htmlUrl: read.file.html_url });
      } catch (error) {
        if (error instanceof Error && error.message === "disconnected") { disconnected = true; controller.abort(); }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, repos.length) }, worker));
  return disconnected ? { kind: "disconnected" } : { kind: "ok", files };
}
