import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchWithGitHubAuth } from "@/lib/github-token";
import { rateLimit } from "@/lib/rate-limit";
import { detectProjectStacks } from "@/lib/stack-detection-server";

/**
 * The tools the owner's active projects use, read from each repository's
 * `about-project.md` (or its root `package.json`) for the Tools section.
 *
 * GET /api/tools/detected → DetectedToolsResponse. Computed on every call and
 * never stored: the repositories are the source of truth, so there is nothing
 * to go stale and nothing to delete when a repository drops a tool. The
 * browser caches the answer for the page session (React Query) and asks again
 * only when the owner presses "Check the repositories again".
 *
 * Active projects are the ones in the sidebar (`projects.is_active`), read
 * with the owner's own session, so RLS decides which rows exist. The GitHub
 * token never leaves the server; the response carries tool names, notes and
 * per-project statuses only.
 */
export const maxDuration = 30;

const MAX_PROJECTS = 50;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const limited = await rateLimit(user.id, { key: "tools-detected", limit: 10, windowSec: 60 });
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const { data, error } = await supabase
    .from("projects")
    .select("id, name, repo_full_name, parent_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .limit(MAX_PROJECTS);
  if (error) {
    return NextResponse.json({ error: "Could not load the active projects." }, { status: 500 });
  }

  const result = await detectProjectStacks(data ?? [], fetchWithGitHubAuth);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
