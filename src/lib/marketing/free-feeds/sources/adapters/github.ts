import type {
  SourceConfig,
  SourceFetchContext,
  SourceItem
} from "../types";
import { parseFeedEntries, projectRssItem, type RssItem } from "./rss";
import { fetchText } from "./util";

/**
 * GitHub's public release feed (`https://github.com/<owner>/<repo>/releases.atom`) needs no token and
 * is not subject to the REST API's 60-requests-per-hour unauthenticated limit (audit C15). It lists
 * the ten newest published releases; drafts never appear in it.
 */
export const GITHUB_RELEASE_FEED_ENTRIES = 10;
/** Release notes are long: huggingface/transformers' feed was 1.4 MB on 22 Oct 2026. Still bounded. */
export const GITHUB_RELEASE_FEED_MAX_BYTES = 3_000_000;

export function githubReleaseFeedUrl(repo: string, base: string): string {
  return new URL(`/${repo}/releases.atom`, base).toString();
}

/**
 * Prefixes the repository to the release title, as the API projection did. The entry's
 * `media:thumbnail` is the release author's 30 px avatar, not a picture of the release, so it is
 * never offered as the item's image.
 */
export function projectReleaseEntries(
  entries: readonly RssItem[],
  repo: string,
  source: SourceConfig,
  now: Date
): SourceItem[] {
  return entries.flatMap((entry) => {
    const item = projectRssItem(
      { ...entry, title: `${repo} ${entry.title?.trim() || "release"}`, enclosure: undefined, mediaContent: undefined, mediaThumbnail: undefined },
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
  const projected = await Promise.all(
    (source.repos ?? []).map(async (repo) => {
      try {
        const xml = await fetchText(githubReleaseFeedUrl(repo, source.url), context, { maxBytes: GITHUB_RELEASE_FEED_MAX_BYTES });
        const entries = await parseFeedEntries(xml);
        const items = projectReleaseEntries(entries, repo, source, context.now);
        // A full page whose oldest release is still inside the window may have dropped older ones.
        const oldest = items.reduce<string | null>((low, item) => (item.publishedAt && (!low || item.publishedAt < low) ? item.publishedAt : low), null);
        if (entries.length >= GITHUB_RELEASE_FEED_ENTRIES && (!context.since || !oldest || Date.parse(oldest) > context.since.getTime())) {
          context.reportIssue?.("upstream-cap");
        }
        return items;
      } catch {
        context.reportIssue?.("fetch-failed");
        return [];
      }
    })
  );
  return projected.flat();
}
