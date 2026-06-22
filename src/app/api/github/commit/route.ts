import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchWithGitHubAuth } from "@/lib/github-token";
import { rejectCrossOrigin } from "@/lib/csrf";
import { normalizeRepoPath, type GithubCommitResult } from "@/lib/github";

const NAME_RE = /^[A-Za-z0-9._-]+$/;
const MAX_CONTENT_BYTES = 1_000_000; // 1 MB — well under GitHub's contents API ceiling.

/**
 * Create or update a single text file in a repo via the GitHub Contents API.
 * Each call is one commit. Used by the Repos panel to push markdown.
 *
 * Body: { owner, repo, path, content, message, branch? }
 */
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const owner = typeof body.owner === "string" ? body.owner.trim() : "";
  const repo = typeof body.repo === "string" ? body.repo.trim() : "";
  const rawPath = typeof body.path === "string" ? body.path : "";
  const content = typeof body.content === "string" ? body.content : null;
  const message =
    typeof body.message === "string" && body.message.trim()
      ? body.message.trim()
      : "";
  const branch =
    typeof body.branch === "string" && body.branch.trim()
      ? body.branch.trim()
      : undefined;

  if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) {
    return NextResponse.json(
      { error: "Invalid owner or repository." },
      { status: 400 },
    );
  }
  const path = normalizeRepoPath(rawPath);
  if (!path) {
    return NextResponse.json({ error: "Invalid file path." }, { status: 400 });
  }
  if (content == null) {
    return NextResponse.json({ error: "Missing content." }, { status: 400 });
  }
  if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) {
    return NextResponse.json(
      { error: "File is too large (1 MB max)." },
      { status: 413 },
    );
  }
  if (!message) {
    return NextResponse.json(
      { error: "A commit message is required." },
      { status: 400 },
    );
  }

  const base = `/repos/${owner}/${repo}/contents/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const refQuery = branch ? `?ref=${encodeURIComponent(branch)}` : "";

  // Look up the current blob sha so an existing file is updated rather than
  // rejected. 404 => new file (no sha).
  let sha: string | undefined;
  const head = await fetchWithGitHubAuth(`${base}${refQuery}`);
  if (head.status === 401) {
    return NextResponse.json(
      { error: "GitHub is not connected.", reason: "no-token" },
      { status: 401 },
    );
  }
  if (head.ok) {
    const existing = (await head.json()) as unknown;
    if (Array.isArray(existing)) {
      return NextResponse.json(
        { error: "That path is a directory, not a file." },
        { status: 422 },
      );
    }
    sha = (existing as { sha?: string }).sha;
  } else if (head.status !== 404) {
    return NextResponse.json(
      { error: "Could not read the target path." },
      { status: head.status },
    );
  }

  const put = await fetchWithGitHubAuth(base, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      ...(sha ? { sha } : {}),
      ...(branch ? { branch } : {}),
    }),
  });

  if (put.status === 401) {
    return NextResponse.json(
      { error: "GitHub is not connected.", reason: "no-token" },
      { status: 401 },
    );
  }
  if (put.status === 409) {
    return NextResponse.json(
      { error: "The file changed on GitHub — reload and retry." },
      { status: 409 },
    );
  }
  if (put.status === 403 || put.status === 404) {
    return NextResponse.json(
      { error: "No write access to that repository." },
      { status: put.status },
    );
  }
  if (!put.ok) {
    const detail = (await put.json().catch(() => null)) as {
      message?: string;
    } | null;
    return NextResponse.json(
      { error: detail?.message ?? "Could not write the file." },
      { status: put.status },
    );
  }

  const json = (await put.json()) as {
    commit: { sha: string; html_url: string };
    content: { html_url: string };
  };
  const result: GithubCommitResult = {
    path,
    updated: Boolean(sha),
    commit: { sha: json.commit.sha, html_url: json.commit.html_url },
    content: { html_url: json.content.html_url },
  };
  return NextResponse.json(result);
}
