import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createGitHubFetcher } from "@/lib/github-token";
import { normalizeRepoPath } from "@/lib/github-file-contract";
import { decodeGithubFile, readGithubJson } from "@/lib/github-file-server";
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
    const response = await createGitHubFetcher(user.id, signal)(`/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`);
    if (!response.ok) return NextResponse.json({ error: "File unavailable." }, { status: [401, 403, 404].includes(response.status) ? response.status : 502, headers });
    const raw = await readGithubJson(response, 1_500_000, signal);
    if (Array.isArray(raw)) return NextResponse.json({ error: "That path is a directory." }, { status: 422, headers });
    return NextResponse.json(decodeGithubFile(raw, path), { headers });
  } catch { return NextResponse.json({ error: "File could not be read." }, { status: 502, headers }); }
}
