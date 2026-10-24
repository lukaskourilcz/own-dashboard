import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createGitHubFetcher } from "@/lib/github-token";
import { awaitWithSignal } from "@/lib/abortable";
import { readTextPrefix } from "@/lib/bounded-text";
import { githubRawRepositorySchema, githubRepositoryFullName } from "@/lib/github-repository-contract";

export const maxDuration = 30;
const headers = { "cache-control": "private, no-store" };
/** A request-local provider fetcher follows safe rename redirects. Return the
 * same narrow identity plus full validated app metadata for scoped workspaces. */
export async function GET(request: Request) {
  const parsed = githubRepositoryFullName.safeParse(new URL(request.url).searchParams.get("repo"));
  if (!parsed.success) return NextResponse.json({ error: "Invalid repository." }, { status: 400, headers });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]);
  try {
    const supabase = await awaitWithSignal(createClient(signal), signal);
    const auth = await awaitWithSignal(supabase.auth.getUser(), signal);
    if (auth.error) throw Error("Authentication unavailable");
    if (!auth.data.user) return NextResponse.json({ error: "Not authenticated." }, { status: 401, headers });
    const response = await awaitWithSignal(createGitHubFetcher(auth.data.user.id, signal)(`/repos/${parsed.data}`, { signal }), signal);
    if (!response.ok) {
      if (response.body) void response.body.cancel().catch(() => undefined);
      if (response.status === 401) return NextResponse.json({ error: "GitHub access unavailable.", reason: response.statusText === "no-token" ? "no-token" : "expired" }, { status: 401, headers });
      if (response.status === 404) return NextResponse.json({ error: "Repository is not visible to this connection." }, { status: 404, headers });
      throw Error("Repository unavailable");
    }
    const prefix = await awaitWithSignal(readTextPrefix(response, 262_144, signal), signal);
    if (prefix.truncated) throw Error("Repository unavailable");
    const repo = githubRawRepositorySchema.parse(JSON.parse(prefix.text));
    return NextResponse.json({ id: repo.id, full_name: repo.full_name, repo }, { headers });
  } catch { return NextResponse.json({ error: "Could not look up the repository." }, { status: 503, headers }); }
}
