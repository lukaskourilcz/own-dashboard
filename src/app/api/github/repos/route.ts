import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchWithGitHubAuth } from "@/lib/github-token";
import type { GithubRepo } from "@/lib/github";

/** Raw subset of the GitHub repo object we care about. */
type RawRepo = {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  description: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  html_url: string;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  pushed_at: string | null;
  updated_at: string | null;
};

/**
 * Returns the authenticated user's repositories, most-recently-pushed first.
 * `sort=pushed` orders by pushed_at — the timestamp we surface as "updated" —
 * and one page of 100 is plenty for an "active repos" dashboard view.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const res = await fetchWithGitHubAuth(
    "/user/repos?sort=pushed&per_page=100&affiliation=owner,collaborator,organization_member",
  );

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
  if (!res.ok) {
    return NextResponse.json(
      { error: "Could not fetch repositories." },
      { status: res.status },
    );
  }

  const raw = (await res.json()) as RawRepo[];
  const repos: GithubRepo[] = raw.map((r) => ({
    id: r.id,
    name: r.name,
    full_name: r.full_name,
    owner: r.owner?.login ?? r.full_name.split("/")[0],
    description: r.description,
    private: r.private,
    fork: r.fork,
    archived: r.archived,
    html_url: r.html_url,
    default_branch: r.default_branch,
    language: r.language,
    stargazers_count: r.stargazers_count,
    pushed_at: r.pushed_at,
    updated_at: r.updated_at,
  }));

  return NextResponse.json({ repos });
}
