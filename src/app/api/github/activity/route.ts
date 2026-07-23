import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchWithGitHubAuth } from "@/lib/github-token";

/**
 * Cross-project recent-commit feed: read-only, bounded fan-out across the
 * owner's active project repositories. Loads a small page of commits per repo
 * (capped), merges them into one time-sorted feed tagged with the project, and
 * returns it for the Work overview. Auth/token handling matches the other
 * GitHub routes; the browser never holds a token.
 */
const MAX_REPOS = 10;
const PER_REPO = 5;
const MAX_ITEMS = 30;

type RawCommit = {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name?: string; date?: string } | null } | null;
  author: { login: string } | null;
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { data: rows } = await supabase
    .from("projects")
    .select("id,name,slug,repo_full_name,updated_at")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .not("repo_full_name", "is", null)
    .order("updated_at", { ascending: false })
    .limit(MAX_REPOS);

  const projects = (rows ?? []).filter(
    (p): p is { id: string; name: string; slug: string; repo_full_name: string; updated_at: string } =>
      Boolean(p.repo_full_name),
  );
  if (projects.length === 0) {
    return NextResponse.json({ items: [], connected: true });
  }

  let disconnected = false;
  const perRepo = await Promise.all(
    projects.map(async (p) => {
      const res = await fetchWithGitHubAuth(
        `/repos/${p.repo_full_name}/commits?per_page=${PER_REPO}`,
      );
      if (res.status === 401) {
        if (res.statusText === "no-token") disconnected = true;
        return [];
      }
      if (!res.ok) return []; // skip repos we can't read (404/403/etc.)
      const raw = (await res.json()) as RawCommit[];
      return raw.map((c) => ({
        projectId: p.id,
        projectName: p.name,
        projectSlug: p.slug,
        repo: p.repo_full_name,
        sha: c.sha,
        shortSha: c.sha.slice(0, 7),
        message: ((c.commit?.message ?? "").split("\n")[0] ?? "").slice(0, 120),
        author: c.author?.login ?? c.commit?.author?.name ?? "",
        date: c.commit?.author?.date ?? "",
        url: c.html_url,
      }));
    }),
  );

  if (disconnected) {
    return NextResponse.json({ items: [], connected: false });
  }

  const items = perRepo
    .flat()
    .filter((c) => c.date)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_ITEMS);

  return NextResponse.json({ items, connected: true });
}
