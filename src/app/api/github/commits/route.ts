import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createGitHubFetcher } from "@/lib/github-token";
import { awaitWithSignal } from "@/lib/abortable";
import { githubRepositoryFullName } from "@/lib/github-repository-contract";
import { githubCommitsResponse } from "@/lib/github-activity-contract";
import { readGithubCodeVolume, readGithubHistory } from "@/lib/github-activity-server";

export const maxDuration = 30;
const headers = { "cache-control": "private, no-store" };
export async function GET(request: Request) {
  const names = new URL(request.url).searchParams.getAll("repo");
  const repo = githubRepositoryFullName.safeParse(names.length === 1 ? names[0] : null);
  if (!repo.success) return NextResponse.json({ error: "Invalid repository." }, { status: 400, headers });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]);
  try {
    const client = await awaitWithSignal(createClient(signal), signal);
    const auth = await awaitWithSignal(client.auth.getUser(), signal);
    if (auth.error) throw Error("Authentication unavailable");
    if (!auth.data.user) return NextResponse.json({ error: "Not authenticated." }, { status: 401, headers });
    const fetcher = createGitHubFetcher(auth.data.user.id, signal);
    const history = await readGithubHistory(fetcher, repo.data, 15, signal);
    if (history.kind === "disconnected") return NextResponse.json({ error: "GitHub access unavailable." }, { status: 401, headers });
    if (history.kind === "not-found") return NextResponse.json({ error: "Repository unavailable." }, { status: 404, headers });
    if (history.kind !== "ok") throw Error("History unavailable");
    const codeVolume = history.commits.length ? await readGithubCodeVolume(fetcher, repo.data, signal) : null;
    return NextResponse.json(githubCommitsResponse.parse({ commits: history.commits, codeVolume }), { headers });
  } catch { return NextResponse.json({ error: "Could not load commit history." }, { status: 503, headers }); }
}
