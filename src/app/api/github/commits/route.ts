import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchWithGitHubAuth } from "@/lib/github-token";

/** owner/repo, matching what we store in `projects.repo_full_name`. */
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

type RawCommit = {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name?: string; date?: string } | null } | null;
  author: { login: string } | null;
};

/**
 * Returns a project repository's recent commits plus a best-effort measure of
 * how much code changed over the last four weeks. Read-only: this never writes
 * to GitHub. Auth + token handling mirror GET /api/github/repos; the browser
 * never sees the token — the server proxies with `fetchWithGitHubAuth`.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const repo = new URL(request.url).searchParams.get("repo")?.trim() ?? "";
  if (!REPO_RE.test(repo)) {
    return NextResponse.json({ error: "Invalid repository." }, { status: 400 });
  }

  const res = await fetchWithGitHubAuth(`/repos/${repo}/commits?per_page=15`);

  if (res.status === 401 && res.statusText === "no-token") {
    return NextResponse.json(
      { error: "GitHub is not connected.", reason: "no-token" },
      { status: 401 },
    );
  }
  if (res.status === 401) {
    return NextResponse.json(
      { error: "GitHub rejected the token.", reason: "expired" },
      { status: 401 },
    );
  }
  // 404 (no access / missing) or 409 (empty repo) → simply no activity.
  if (res.status === 404 || res.status === 409) {
    return NextResponse.json({ commits: [], codeVolume: null });
  }
  if (!res.ok) {
    return NextResponse.json({ error: "Could not fetch commits." }, { status: res.status });
  }

  const raw = (await res.json()) as RawCommit[];
  const commits = raw.map((c) => ({
    sha: c.sha,
    shortSha: c.sha.slice(0, 7),
    message: ((c.commit?.message ?? "").split("\n")[0] ?? "").slice(0, 120),
    author: c.author?.login ?? c.commit?.author?.name ?? "",
    date: c.commit?.author?.date ?? "",
    url: c.html_url,
  }));

  // Weekly [timestamp, additions, deletions]; sum the most recent four weeks.
  // The stats endpoint can answer 202 while GitHub computes — treat any
  // non-array as "not available yet" rather than an error.
  let codeVolume: { additions: number; deletions: number; weeks: number } | null = null;
  try {
    const stats = await fetchWithGitHubAuth(`/repos/${repo}/stats/code_frequency`);
    if (stats.ok) {
      const weeks = (await stats.json()) as [number, number, number][];
      if (Array.isArray(weeks) && weeks.length > 0) {
        const recent = weeks.slice(-4);
        const additions = recent.reduce((sum, w) => sum + (w[1] ?? 0), 0);
        const deletions = recent.reduce((sum, w) => sum + (w[2] ?? 0), 0);
        codeVolume = { additions, deletions: Math.abs(deletions), weeks: recent.length };
      }
    }
  } catch {
    // Code-volume stats are a nice-to-have; commits already answer the request.
  }

  return NextResponse.json({ commits, codeVolume });
}
