import { NextResponse } from "next/server";
import { fetchWithGitHubAuth } from "@/lib/github-token";
import { normalizeRepoPath } from "@/lib/github";

const NAME_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Read a single text file from a repo via the GitHub Contents API.
 * GET /api/github/file?owner=&repo=&path=  → { content, html_url }.
 * Used by the "App costs & scaling" cards to load stack-and-scaling.md.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const owner = (url.searchParams.get("owner") ?? "").trim();
  const repo = (url.searchParams.get("repo") ?? "").trim();
  const path = normalizeRepoPath(url.searchParams.get("path") ?? "");

  if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) {
    return NextResponse.json(
      { error: "Invalid owner or repository." },
      { status: 400 },
    );
  }
  if (!path) {
    return NextResponse.json({ error: "Invalid file path." }, { status: 400 });
  }

  const apiPath = `/repos/${owner}/${repo}/contents/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

  const res = await fetchWithGitHubAuth(apiPath);
  if (res.status === 401) {
    return NextResponse.json(
      { error: "GitHub is not connected.", reason: "no-token" },
      { status: 401 },
    );
  }
  if (res.status === 404) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
  if (!res.ok) {
    return NextResponse.json(
      { error: "Could not read the file." },
      { status: res.status },
    );
  }

  const json = (await res.json()) as unknown;
  if (Array.isArray(json)) {
    return NextResponse.json(
      { error: "That path is a directory." },
      { status: 422 },
    );
  }
  const file = json as {
    content?: string;
    encoding?: string;
    html_url?: string;
  };
  const content =
    file.encoding === "base64" && file.content
      ? Buffer.from(file.content, "base64").toString("utf8")
      : "";

  return NextResponse.json({ content, html_url: file.html_url ?? null });
}
