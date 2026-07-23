/**
 * Client-safe GitHub types shared by the API routes and the Repos panel.
 * No secrets, no server-only imports — safe to pull into client components.
 */

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

/** Result of a successful commit via POST /api/github/commit. */
export type GithubCommitResult = {
  /** Path the file was written to. */
  path: string;
  /** Whether the file already existed (update) or was newly created. */
  updated: boolean;
  commit: { sha: string; html_url: string };
  content: { html_url: string };
};

/**
 * Guard a user-supplied repo path: relative, no traversal, no leading slash,
 * non-empty segments. Returns a normalized path or null if it's unsafe.
 * Shared so the panel can validate before sending and the route can re-check.
 */
export function normalizeRepoPath(raw: string): string | null {
  const trimmed = raw.trim().replace(/^\/+/, "");
  if (!trimmed) return null;
  const segments = trimmed.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") return null;
  }
  return segments.join("/");
}

// ---------------------------------------------------------------------------
// Client-side data helpers. Plain fetch wrappers around our own API routes,
// shared by the Repos panel and the "Publish to repo" dialog so both speak the
// same protocol (and handle the not-connected case identically).
// ---------------------------------------------------------------------------

export type LoadReposResult =
  | { kind: "ok"; repos: GithubRepo[] }
  | { kind: "disconnected" }
  | { kind: "error" };

/** Fetch repos as a plain result (no React state) so callers can apply it
 * inside a deferred callback — keeps setState out of effect bodies. */
export async function loadReposResult(): Promise<LoadReposResult> {
  try {
    const res = await fetch("/api/github/repos");
    if (res.status === 401) return { kind: "disconnected" };
    if (!res.ok) return { kind: "error" };
    const json = (await res.json()) as { repos: GithubRepo[] };
    return { kind: "ok", repos: json.repos };
  } catch {
    return { kind: "error" };
  }
}

export type CommitInput = {
  owner: string;
  repo: string;
  path: string;
  content: string;
  message: string;
  branch?: string;
};

export type CommitOutcome =
  | { ok: true; result: GithubCommitResult }
  | { ok: false; status: number; error: string };

/** POST a single-file commit to /api/github/commit and normalize the result.
 * `status === 401` signals GitHub disconnected — callers surface a reconnect. */
export async function commitFile(input: CommitInput): Promise<CommitOutcome> {
  try {
    const res = await fetch("/api/github/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = (await res.json().catch(() => null)) as
      | (GithubCommitResult & { error?: string })
      | null;
    if (res.ok && json) return { ok: true, result: json as GithubCommitResult };
    return {
      ok: false,
      status: res.status,
      error: (json as { error?: string } | null)?.error ?? "commit failed",
    };
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
}

export type RepoFileResult =
  | { kind: "ok"; content: string; htmlUrl: string | null }
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
): Promise<RepoFileResult> {
  try {
    const qs = new URLSearchParams({ owner, repo, path });
    const res = await fetch(`/api/github/file?${qs.toString()}`);
    if (res.status === 401) return { kind: "disconnected" };
    if (res.status === 404) return { kind: "not-found" };
    if (!res.ok) return { kind: "error" };
    const json = (await res.json()) as {
      content: string;
      html_url: string | null;
    };
    return { kind: "ok", content: json.content, htmlUrl: json.html_url };
  } catch {
    return { kind: "error" };
  }
}

/** A single commit surfaced by GET /api/github/commits. */
export type GithubCommit = {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
  url: string;
};

/** Additions/deletions over a recent window (best-effort; may be null while
 * GitHub is still computing repository statistics). */
export type GithubCodeVolume = {
  additions: number;
  deletions: number;
  weeks: number;
};

export type ProjectCommitsResult =
  | { kind: "ok"; commits: GithubCommit[]; codeVolume: GithubCodeVolume | null }
  | { kind: "disconnected" }
  | { kind: "error" };

/** Load a project repo's recent commits + recent code volume as a plain
 * result, so callers can render change-history without holding a token. */
export async function loadProjectCommits(
  repoFullName: string,
): Promise<ProjectCommitsResult> {
  try {
    const res = await fetch(
      `/api/github/commits?repo=${encodeURIComponent(repoFullName)}`,
    );
    if (res.status === 401) return { kind: "disconnected" };
    if (!res.ok) return { kind: "error" };
    const json = (await res.json()) as {
      commits: GithubCommit[];
      codeVolume: GithubCodeVolume | null;
    };
    return { kind: "ok", commits: json.commits, codeVolume: json.codeVolume };
  } catch {
    return { kind: "error" };
  }
}
