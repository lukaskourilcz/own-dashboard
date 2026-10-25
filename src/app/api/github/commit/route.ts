import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createGitHubFetcher } from "@/lib/github-token";
import { rejectCrossOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import { awaitWithSignal } from "@/lib/abortable";
import { readTextPrefix } from "@/lib/bounded-text";
import { githubCommitInput, githubCommitResult, MAX_GITHUB_FILE_BYTES } from "@/lib/github-file-contract";
import { gitBlobSha, githubFileMetadata, readGithubJson } from "@/lib/github-file-server";
import { commitRepositoryFile, RepositoryFileConflict } from "@/lib/github-repository-file-server";
import { z } from "zod";

export const maxDuration = 30;
const headers = { "cache-control": "private, no-store" };
const failure = (status: number, error = "Commit could not be confirmed. Check the repository before retrying.") => NextResponse.json({ error }, { status, headers });

/** A reviewed edit compares the file's blob version twice: this read and
 * GitHub's atomic PUT precondition. Full replacement requires explicit intent. */
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]);
  try {
    const supabase = await createClient(signal);
    const { data: { user }, error: authError } = await awaitWithSignal(supabase.auth.getUser(), signal);
    if (authError || !user) return failure(401, "Not authenticated.");
    let input: z.output<typeof githubCommitInput>;
    try {
      const body = await awaitWithSignal(readTextPrefix(new Response(request.body), 2_100_000), signal);
      if (body.truncated) return failure(413, "Request too large.");
      const parsed = githubCommitInput.safeParse(JSON.parse(body.text));
      if (!parsed.success) return failure(400, "Invalid commit request.");
      input = parsed.data;
      if (Buffer.byteLength(input.content, "utf8") > MAX_GITHUB_FILE_BYTES) return failure(413, "File too large.");
    } catch { return failure(signal.aborted ? 503 : 400, "Invalid or unavailable commit request."); }
    const limited = await awaitWithSignal(rateLimit(user.id, { key: "github-commit", limit: 10, windowSec: 60 }), signal);
    if (!limited.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { ...headers, "Retry-After": String(limited.retryAfter) } });
    const fetcher = createGitHubFetcher(user.id, signal);
    if (input.intent === "edit" && input.expectedRepositoryId !== undefined) {
      const result = await commitRepositoryFile(fetcher, { ...input, expectedRepositoryId: input.expectedRepositoryId }, signal);
      return NextResponse.json(result, { headers });
    }
    const base = `/repos/${input.owner}/${input.repo}/contents/${input.path.split("/").map(encodeURIComponent).join("/")}`;
    const head = await fetcher(`${base}${input.branch ? `?ref=${encodeURIComponent(input.branch)}` : ""}`);
    if (head.status === 401) return failure(401, "GitHub is not connected.");
    if (!head.ok && head.status !== 404) return failure(head.status === 403 ? 403 : 502);
    let existing: z.output<typeof githubFileMetadata> | null = null;
    if (head.ok) {
      const raw = await readGithubJson(head, 1_500_000, signal);
      if (Array.isArray(raw)) return failure(422, "That path is a directory.");
      existing = githubFileMetadata.parse(raw);
      if (existing.path !== input.path) return failure(502);
    }
    if (input.intent === "edit" && existing?.sha !== input.expectedSha) return failure(409, "File changed. Reload it before editing.");
    if (existing && existing.sha === gitBlobSha(input.content, existing.sha.length)) {
      return NextResponse.json(githubCommitResult.parse({ path: input.path, updated: true, unchanged: true, commit: null,
        content: { sha: existing.sha, html_url: existing.html_url } }), { headers });
    }
    // A read can resolve a repository rename. Never replay a redirected write.
    const writePath = head.url ? new URL(head.url).pathname : base;
    const put = await fetcher(writePath, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      message: input.message, content: Buffer.from(input.content, "utf8").toString("base64"),
      ...(existing ? { sha: existing.sha } : {}), ...(input.branch ? { branch: input.branch } : {}),
    }) });
    if (!put.ok) return failure([401, 403, 404, 409, 422].includes(put.status) ? put.status : 502);
    const raw = z.object({ content: githubFileMetadata, commit: z.object({ sha: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/), html_url: z.string() }) }).parse(await readGithubJson(put, 65_536, signal));
    if (raw.content.path !== input.path || raw.content.size !== Buffer.byteLength(input.content, "utf8") || raw.content.sha !== gitBlobSha(input.content, raw.content.sha.length)) return failure(502);
    return NextResponse.json(githubCommitResult.parse({ path: input.path, updated: Boolean(existing), unchanged: false,
      commit: raw.commit, content: { sha: raw.content.sha, html_url: raw.content.html_url } }), { headers });
  } catch (error) { return failure(error instanceof RepositoryFileConflict ? 409 : error instanceof Error && error.message === "disconnected" ? 401 : signal.aborted ? 503 : 502); }
}
