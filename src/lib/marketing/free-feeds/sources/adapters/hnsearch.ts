import type {
  SourceConfig,
  SourceFetchContext,
  SourceItem
} from "../types";
import { fetchJson, makeItem } from "./util";

/**
 * Hacker News search through the free Algolia API (`search_by_date`), used for Show HN posts with many points
 * (#151). The registered URL carries the query (`tags`, `numericFilters`); only `hitsPerPage` is set here.
 */
interface HnSearchResponse {
  hits?: Array<{
    objectID?: string;
    title?: string;
    url?: string | null;
    story_text?: string | null;
    author?: string;
    created_at?: string;
    points?: number;
  }>;
}

export function projectHnSearch(
  data: HnSearchResponse,
  source: SourceConfig,
  now: Date
): SourceItem[] {
  return (data.hits ?? []).flatMap((hit) => {
    if (!hit.objectID || !/^\d{1,12}$/.test(hit.objectID)) return [];
    const item = makeItem(
      hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      {
        title: hit.title,
        summary: hit.story_text ?? undefined,
        publishedAt: hit.created_at,
        author: hit.author,
        externalId: hit.objectID
      },
      source,
      now
    );
    return item ? [item] : [];
  });
}

export async function fetchHnSearch(
  source: SourceConfig,
  context: SourceFetchContext
): Promise<SourceItem[]> {
  const url = new URL(source.url);
  url.searchParams.set("hitsPerPage", String(source.maxItems));
  const data = await fetchJson<HnSearchResponse>(url.toString(), context);
  if ((data.hits?.length ?? 0) >= source.maxItems) context.reportIssue?.("upstream-cap");
  return projectHnSearch(data, source, context.now);
}
