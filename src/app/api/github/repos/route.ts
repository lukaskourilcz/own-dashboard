import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createGitHubFetcher } from "@/lib/github-token";
import { awaitWithSignal } from "@/lib/abortable";
import { readTextPrefix } from "@/lib/bounded-text";
import { githubHasNextPage, githubRawRepositoryPage } from "@/lib/github-repository-contract";

export const maxDuration = 30;
const headers = { "cache-control": "private, no-store" };
/** One bounded recent page; a continuation is explicit, never called a full
 * catalog. Project workspaces can resolve their own repository directly. */
export async function GET(request: Request) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]);
  try {
    const supabase = await awaitWithSignal(createClient(signal), signal);
    const auth = await awaitWithSignal(supabase.auth.getUser(), signal);
    if (auth.error) throw Error("Authentication unavailable");
    if (!auth.data.user) return NextResponse.json({ error: "Not authenticated." }, { status: 401, headers });
    const response = await awaitWithSignal(createGitHubFetcher(auth.data.user.id, signal)("/user/repos?sort=pushed&per_page=100&affiliation=owner,collaborator,organization_member", { signal }), signal);
    if (!response.ok) {
      if (response.body) void response.body.cancel().catch(() => undefined);
      if (response.status === 401) return NextResponse.json({ error: "GitHub access unavailable.", reason: response.statusText === "no-token" ? "no-token" : "expired" }, { status: 401, headers });
      throw Error("Repositories unavailable");
    }
    const prefix = await awaitWithSignal(readTextPrefix(response, 2_097_152, signal), signal);
    if (prefix.truncated) throw Error("Repositories unavailable");
    const repos = githubRawRepositoryPage.parse(JSON.parse(prefix.text));
    return NextResponse.json({ repos, hasMore: githubHasNextPage(response.headers.get("link")) }, { headers });
  } catch { return NextResponse.json({ error: "Could not load repositories." }, { status: 503, headers }); }
}
