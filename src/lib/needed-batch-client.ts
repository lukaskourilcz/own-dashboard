import { awaitWithSignal } from "@/lib/abortable";
import { readTextPrefix } from "@/lib/bounded-text";
import type { GithubRepo } from "@/lib/github";
import type { NeededBatchResult } from "@/lib/needed-batch-contract";
export type { NeededBatchResult };
type Repository = Pick<GithubRepo, "id" | "owner" | "name">;
export const neededBatchQueryKey = (repos: Repository[]) => ["github", "file", "needed-batch", repos.map(repo => [repo.id, repo.owner, repo.name] as const).sort((left, right) => left[0] - right[0])] as const;

/** One bounded read for the displayed repositories. Caller cancellation must
 * remain cancellation, so a late reply cannot replace disconnected cache data. */
export async function loadNeededBatch(repos: Repository[], parent?: AbortSignal): Promise<NeededBatchResult> {
  if (!repos.length) return { kind: "ok", files: [] };
  const unavailable = (): NeededBatchResult => ({ kind: "ok", files: repos.map(repo => ({ repoId: String(repo.id), result: { kind: "error" } })) });
  const signal = AbortSignal.any([AbortSignal.timeout(30_000), ...(parent ? [parent] : [])]);
  try {
    const { neededBatchInput, neededBatchResultSchema } = await awaitWithSignal(import("@/lib/needed-batch-contract"), signal);
    const input = neededBatchInput.parse({ repos: repos.map(({ id, owner, name }) => ({ id, owner, name })) });
    signal.throwIfAborted();
    const response = await awaitWithSignal(fetch("/api/github/needed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal }), signal);
    if (response.status === 401) return { kind: "disconnected" };
    if (!response.ok) return unavailable();
    const body = await awaitWithSignal(readTextPrefix(response, 10 * 1024 * 1024), signal);
    if (body.truncated) return unavailable();
    const result = neededBatchResultSchema.parse(JSON.parse(body.text));
    if (result.kind === "disconnected") return result;
    const ids = new Set(input.repos.map(repo => String(repo.id)));
    for (const file of result.files) if (!ids.delete(file.repoId)) return unavailable();
    if (ids.size) return unavailable();
    return result.files.some(file => file.result.kind === "disconnected") ? { kind: "disconnected" } : result;
  } catch {
    if (parent?.aborted) throw new DOMException("Repository read cancelled", "AbortError");
    return unavailable();
  }
}
