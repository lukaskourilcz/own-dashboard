import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchWithGitHubAuth } from "@/lib/github-token";

/** owner/repo, matching what we store in `projects.repo_full_name`. */
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Resolves a repository full name to its GitHub id and current full name.
 *
 *   GET /api/github/repos/lookup?repo=owner/name
 *
 * GitHub redirects a renamed repository's old name to the repository itself,
 * so an old name stored on a project still resolves to the stable id. The
 * Projects auto-sync uses this only before it would create a project, which
 * turns a rename into an update instead of a duplicate. Read-only.
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

  const res = await fetchWithGitHubAuth(`/repos/${repo}`);
  if (res.status === 401) {
    return NextResponse.json(
      { error: "GitHub is not connected.", reason: res.statusText === "no-token" ? "no-token" : "expired" },
      { status: 401 },
    );
  }
  if (res.status === 404) {
    return NextResponse.json({ error: "Repository not found." }, { status: 404 });
  }
  if (!res.ok) {
    return NextResponse.json(
      { error: "Could not look up the repository." },
      { status: 502 },
    );
  }

  const raw = (await res.json()) as { id?: unknown; full_name?: unknown };
  if (typeof raw.id !== "number" || typeof raw.full_name !== "string") {
    return NextResponse.json(
      { error: "Could not look up the repository." },
      { status: 502 },
    );
  }
  return NextResponse.json({ id: raw.id, full_name: raw.full_name });
}
