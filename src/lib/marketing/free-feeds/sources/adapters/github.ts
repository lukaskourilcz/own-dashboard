import type {
  SourceConfig,
  SourceFetchContext,
  SourceItem
} from "../types";
import { fetchJson, makeItem } from "./util";

interface GithubRelease {
  id?: number;
  html_url?: string;
  name?: string | null;
  tag_name?: string;
  body?: string | null;
  draft?: boolean;
  published_at?: string;
  author?: { login?: string };
}

export function projectReleases(
  releases: GithubRelease[],
  repo: string,
  source: SourceConfig,
  now: Date
): SourceItem[] {
  return releases.flatMap((release) => {
    if (release.draft || !release.html_url) return [];
    const item = makeItem(
      release.html_url,
      {
        title: `${repo} ${release.name || release.tag_name || "release"}`,
        summary: release.body ?? undefined,
        publishedAt: release.published_at,
        author: release.author?.login,
        externalId: release.id ? String(release.id) : undefined
      },
      source,
      now
    );
    return item ? [item] : [];
  });
}

export async function fetchGithub(
  source: SourceConfig,
  context: SourceFetchContext
): Promise<SourceItem[]> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "boardlessai-source-shadow/0.1"
  };
  const projected = await Promise.all(
    (source.repos ?? []).map(async (repo) => {
      try {
        const url = new URL(`/repos/${repo}/releases`, source.url);
        url.searchParams.set("per_page", "3");
        const releases = await fetchJson<GithubRelease[]>(url.toString(), context, {
          headers
        });
        if (releases.length >= 3) context.reportIssue?.("upstream-cap");
        return projectReleases(releases, repo, source, context.now);
      } catch {
        context.reportIssue?.("fetch-failed");
        return [];
      }
    })
  );
  return projected.flat();
}
