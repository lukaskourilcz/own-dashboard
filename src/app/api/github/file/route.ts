import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createGitHubFetcher } from "@/lib/github-token";
import { normalizeRepoPath } from "@/lib/github-file-contract";
import { readGithubTextFile } from "@/lib/github-file-server";
import { awaitWithSignal } from "@/lib/abortable";
const headers = { "cache-control": "private, no-store" };
export async function GET(request: Request) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]);
  try {
    const supabase = await createClient(signal);
    const { data: { user } } = await awaitWithSignal(supabase.auth.getUser(), signal);
    if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401, headers });
    const query = new URL(request.url).searchParams;
    const owner = (query.get("owner") ?? "").trim(), repo = (query.get("repo") ?? "").trim(), path = normalizeRepoPath(query.get("path") ?? "");
    if (![owner, repo].every(name => /^[A-Za-z0-9._-]{1,100}$/.test(name) && name !== "." && name !== "..") || !path) return NextResponse.json({ error: "Invalid file request." }, { status: 400, headers });
    const read = await readGithubTextFile(createGitHubFetcher(user.id, signal), owner, repo, path, signal);
    if (!read.ok) return NextResponse.json({ error: "File unavailable." }, { status: read.status, headers });
    return NextResponse.json(read.file, { headers });
  } catch { return NextResponse.json({ error: "File could not be read." }, { status: 502, headers }); }
}
