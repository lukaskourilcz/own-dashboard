/**
 * Client-safe GitHub types shared by the API routes and the Repos panel.
 * No secrets, no server-only imports — safe to pull into client components.
 */

import { MAX_GITHUB_FILE_BYTES, normalizeRepoPath } from "@/lib/github-path";
import { readTextPrefix } from "@/lib/bounded-text";
import { awaitWithSignal } from "@/lib/abortable";
export { normalizeRepoPath };
export type { CommitInput, GithubCommitResult } from "@/lib/github-file-contract";
import type { CommitInput, GithubCommitResult } from "@/lib/github-file-contract";
import type { DetectedToolsResponse } from "@/lib/stack-detection";

/** Trimmed repository shape returned by GET /api/github/repos. */
export type GithubRepo = {
  id: number;
  name: string;
  full_name: string;
  owner: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  html_url: string;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  /** Last push to any branch — the "last updated" most people mean. */
  pushed_at: string | null;
  /** Last metadata change (description, settings, stars…). */
  updated_at: string | null;
};

// ---------------------------------------------------------------------------
// Client-side data helpers. Plain fetch wrappers around our own API routes,
// shared by the Repos panel and the "Publish to repo" dialog so both speak the
// same protocol (and handle the not-connected case identically).
// ---------------------------------------------------------------------------

export type LoadReposResult = (
  | { kind: "ok"; repos: GithubRepo[]; hasMore?: boolean }
  | { kind: "disconnected" }
  | { kind: "error" }) & { checkedAt?: number };

export type RepositoryLookupResult = (
  | { kind: "ok"; repo: GithubRepo }
  | { kind: "not-found" }
  | { kind: "disconnected" }
  | { kind: "error" }) & { checkedAt?: number };

function repositoryReadSignal(parent?: AbortSignal) {
  return AbortSignal.any([AbortSignal.timeout(25_000), ...(parent ? [parent] : [])]);
}
async function repositoryJson(response: Response, signal: AbortSignal, bound: number): Promise<unknown> {
  const prefix = await awaitWithSignal(readTextPrefix(response, bound, signal), signal);
  if (prefix.truncated) throw Error("Repository result unavailable");
  return JSON.parse(prefix.text);
}
function cancelRepositoryBody(response: Response) {
  if (response.body) void response.body.cancel().catch(() => undefined);
}

/** Plain typed results remain useful outside React. Query wrappers throw on
 * unavailable results so a failed refresh cannot replace confirmed data. */
export async function loadReposResult(context?: { signal: AbortSignal }): Promise<LoadReposResult> {
  const signal = repositoryReadSignal(context?.signal);
  try {
    const response = await awaitWithSignal(fetch("/api/github/repos", { cache: "no-store", signal }), signal);
    if (!response.ok) { cancelRepositoryBody(response); return { kind: response.status === 401 ? "disconnected" : "error", checkedAt: Date.now() }; }
    const body = await repositoryJson(response, signal, 1_048_576);
    const { githubRepositoriesResponse } = await awaitWithSignal(import("@/lib/github-repository-contract"), signal);
    const result = githubRepositoriesResponse.parse(body);
    return { kind: "ok", ...result, checkedAt: Date.now() };
  } catch { return { kind: "error" }; }
}

export async function loadRepositoryResult(fullName: string, parent?: AbortSignal): Promise<RepositoryLookupResult> {
  const signal = repositoryReadSignal(parent);
  try {
    const { githubRepositoryFullName, githubRepositoryLookupResponse } = await awaitWithSignal(import("@/lib/github-repository-contract"), signal);
    const name = githubRepositoryFullName.parse(fullName);
    const response = await awaitWithSignal(fetch(`/api/github/repos/lookup?repo=${encodeURIComponent(name)}`, { cache: "no-store", signal }), signal);
    if (!response.ok) {
      cancelRepositoryBody(response);
      return { kind: response.status === 401 ? "disconnected" : response.status === 404 ? "not-found" : "error", checkedAt: Date.now() };
    }
    const result = githubRepositoryLookupResponse.parse(await repositoryJson(response, signal, 65_536));
    return { kind: "ok", repo: result.repo, checkedAt: Date.now() };
  } catch { return { kind: "error" }; }
}

/** Legacy narrow caller; availability-aware synchronization uses the complete
 * result instead of treating an error as proof that a repository is missing. */
export async function lookupRepoIdentity(fullName: string): Promise<{ id: number; full_name: string } | null> {
  const result = await loadRepositoryResult(fullName);
  return result.kind === "ok" ? { id: result.repo.id, full_name: result.repo.full_name } : null;
}

export type CommitOutcome =
  | { ok: true; result: GithubCommitResult }
  | { ok: false; status: number; error: string };

/** POST a single-file commit to /api/github/commit and normalize the result.
 * `status === 401` signals GitHub disconnected — callers surface a reconnect. */
export async function commitFile(input: CommitInput, parent?: AbortSignal): Promise<CommitOutcome> {
  const signal = AbortSignal.any([AbortSignal.timeout(30_000), ...(parent ? [parent] : [])]);
  try {
    const { githubCommitInput, githubCommitResult } = await awaitWithSignal(import("@/lib/github-file-contract"), signal);
    const parsed = githubCommitInput.safeParse(input);
    if (!parsed.success) return { ok: false, status: 400, error: "invalid-input" };
    if (new TextEncoder().encode(parsed.data.content).byteLength > MAX_GITHUB_FILE_BYTES) return { ok: false, status: 413, error: "too-large" };
    signal.throwIfAborted();
    const response = await awaitWithSignal(fetch("/api/github/commit", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data), signal,
    }), signal);
    if (!response.ok) return { ok: false, status: response.status, error: "commit-unconfirmed" };
    const prefix = await awaitWithSignal(readTextPrefix(response, 32_768), signal);
    if (prefix.truncated) return { ok: false, status: 502, error: "commit-unconfirmed" };
    const result = githubCommitResult.safeParse(JSON.parse(prefix.text));
    if (!result.success || result.data.path !== parsed.data.path) return { ok: false, status: 502, error: "commit-unconfirmed" };
    return { ok: true, result: result.data };
  } catch { return { ok: false, status: 0, error: "commit-unconfirmed" }; }
}

export type RepoFileResult =
  | { kind: "ok"; content: string; htmlUrl: string | null; sha: string }
  | { kind: "not-found" }
  | { kind: "disconnected" }
  | { kind: "error" };

/** Read a text file from a repo root via /api/github/file. Distinguishes
 * "no token" (disconnected) and "missing file" (not-found) so the UI can show
 * the right affordance. */
export async function loadRepoFile(
  owner: string,
  repo: string,
  path: string,
  parent?: AbortSignal,
): Promise<RepoFileResult> {
  try {
    const qs = new URLSearchParams({ owner, repo, path });
    const signal = AbortSignal.any([AbortSignal.timeout(30_000), ...(parent ? [parent] : [])]);
    signal.throwIfAborted();
    const res = await awaitWithSignal(fetch(`/api/github/file?${qs.toString()}`, { signal }), signal);
    if (res.status === 401) return { kind: "disconnected" };
    if (res.status === 404) return { kind: "not-found" };
    if (!res.ok) return { kind: "error" };
    const prefix = await awaitWithSignal(readTextPrefix(res, 2_100_000), signal);
    if (prefix.truncated) return { kind: "error" };
    const { githubFileResponse } = await awaitWithSignal(import("@/lib/github-file-contract"), signal);
    const json = githubFileResponse.parse(JSON.parse(prefix.text));
    return { kind: "ok", content: json.content, htmlUrl: json.html_url, sha: json.sha };
  } catch {
    return { kind: "error" };
  }
}

export type DetectedToolsResult =
  | { kind: "ok"; data: DetectedToolsResponse }
  | { kind: "disconnected" }
  | { kind: "rate-limited" }
  | { kind: "error" };

/** The tools the active projects' repositories list, via
 * GET /api/tools/detected. The token stays on the server. */
export async function loadDetectedTools(): Promise<DetectedToolsResult> {
  try {
    const res = await fetch("/api/tools/detected", { cache: "no-store" });
    if (res.status === 429) return { kind: "rate-limited" };
    if (!res.ok) return { kind: "error" };
    const data = (await res.json()) as DetectedToolsResponse;
    if (!data.connected) return { kind: "disconnected" };
    return { kind: "ok", data };
  } catch {
    return { kind: "error" };
  }
}

/** Read-only history uses the same bounded/cancellable transport as metadata. */
export type ProjectCommitsResult =
  | { kind: "ok"; commits: import("@/lib/github-activity-contract").GithubHistoryCommit[]; codeVolume: { additions: number; deletions: number; weeks: number } | null }
  | { kind: "disconnected" | "not-found" | "error" };
export async function loadProjectCommits(repoFullName: string, parent?: AbortSignal): Promise<ProjectCommitsResult> {
  const signal = repositoryReadSignal(parent);
  try {
    const { githubRepositoryFullName } = await awaitWithSignal(import("@/lib/github-repository-contract"), signal);
    const name = githubRepositoryFullName.parse(repoFullName);
    const response = await awaitWithSignal(fetch(`/api/github/commits?repo=${encodeURIComponent(name)}`, { cache: "no-store", signal }), signal);
    if (!response.ok) { cancelRepositoryBody(response); return { kind: response.status === 401 ? "disconnected" : response.status === 404 ? "not-found" : "error" }; }
    const { githubCommitsResponse } = await awaitWithSignal(import("@/lib/github-activity-contract"), signal);
    return { kind: "ok", ...githubCommitsResponse.parse(await repositoryJson(response, signal, 131_072)) };
  } catch { return { kind: "error" }; }
}
export type CrossProjectActivityResult =
  | { kind: "ok"; items: import("@/lib/github-activity-contract").GithubActivityCommit[]; scope: import("@/lib/github-activity-contract").GithubActivityScope }
  | { kind: "disconnected" | "error" };
export async function loadCrossProjectActivity(parent?: AbortSignal): Promise<CrossProjectActivityResult> {
  const signal = repositoryReadSignal(parent);
  try {
    const response = await awaitWithSignal(fetch("/api/github/activity", { cache: "no-store", signal }), signal);
    if (!response.ok) { cancelRepositoryBody(response); return { kind: response.status === 401 ? "disconnected" : "error" }; }
    const { githubActivityResponse } = await awaitWithSignal(import("@/lib/github-activity-contract"), signal);
    const result = githubActivityResponse.parse(await repositoryJson(response, signal, 262_144));
    return result.connected ? { kind: "ok", items: result.items, scope: result.scope } : { kind: "disconnected" };
  } catch { return { kind: "error" }; }
}
