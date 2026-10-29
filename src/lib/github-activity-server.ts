import "server-only";
import { awaitWithSignal } from "@/lib/abortable";
import { readTextPrefix } from "@/lib/bounded-text";
import { githubRawCommitPage, summarizeGithubCodeVolume, type GithubHistoryCommit } from "@/lib/github-activity-contract";

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;
export type GithubHistoryRead = { kind: "ok"; commits: GithubHistoryCommit[] } | { kind: "disconnected" | "not-found" | "error" };
function cancel(response: Response) { if (response.body) void response.body.cancel().catch(() => undefined); }
async function json(response: Response, signal: AbortSignal, maximum: number): Promise<unknown> {
  const result = await awaitWithSignal(readTextPrefix(response, maximum, signal), signal);
  if (result.truncated) throw Error("Commit history unavailable");
  return JSON.parse(result.text);
}
/** One page with an explicit request/body budget. Only the documented empty
 * repository message proves a 409 empty; other conflicts stay unavailable. */
export async function readGithubHistory(fetcher: Fetcher, repo: string, maximum: 5 | 15, signal: AbortSignal): Promise<GithubHistoryRead> {
  try {
    signal.throwIfAborted();
    const response = await awaitWithSignal(fetcher(`/repos/${repo}/commits?per_page=${maximum}`, { signal }), signal);
    if (response.status === 409) {
      const body = await json(response, signal, 4096);
      if (body && typeof body === "object" && "message" in body && body.message === "Git Repository is empty.") return { kind: "ok", commits: [] };
      return { kind: "error" };
    }
    if (!response.ok) { cancel(response); return { kind: response.status === 401 ? "disconnected" : response.status === 404 ? "not-found" : "error" }; }
    return { kind: "ok", commits: githubRawCommitPage(maximum).parse(await json(response, signal, maximum === 5 ? 262_144 : 524_288)) };
  } catch { return { kind: "error" }; }
}
/** Optional statistics never block the primary history for more than three
 * seconds and 202/204/422 do not start a polling loop. */
export async function readGithubCodeVolume(fetcher: Fetcher, repo: string, parent: AbortSignal) {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(3000)]);
  try {
    signal.throwIfAborted();
    const response = await awaitWithSignal(fetcher(`/repos/${repo}/stats/code_frequency`, { signal }), signal);
    if (response.status !== 200) { cancel(response); return null; }
    return summarizeGithubCodeVolume(await json(response, signal, 524_288));
  } catch { return null; }
}
