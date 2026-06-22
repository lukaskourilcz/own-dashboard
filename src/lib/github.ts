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
