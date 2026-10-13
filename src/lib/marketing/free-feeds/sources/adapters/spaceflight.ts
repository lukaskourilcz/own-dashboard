import type {
  SourceConfig,
  SourceFetchContext,
  SourceItem
} from "../types";
import { fetchJson, makeItem } from "./util";

interface SpaceflightResponse {
  results?: Array<{
    id?: number;
    title?: string;
    url?: string;
    summary?: string;
    published_at?: string;
    news_site?: string;
  }>;
}

export function projectSpaceflight(
  data: SpaceflightResponse,
  source: SourceConfig,
  now: Date
): SourceItem[] {
  return (data.results ?? []).flatMap((article) => {
    if (!article.url) return [];
    const item = makeItem(
      article.url,
      {
        title: article.title,
        summary: article.summary,
        publishedAt: article.published_at,
        author: article.news_site,
        externalId: article.id ? String(article.id) : undefined
      },
      source,
      now
    );
    return item ? [item] : [];
  });
}

export async function fetchSpaceflight(
  source: SourceConfig,
  context: SourceFetchContext
): Promise<SourceItem[]> {
  const url = new URL(source.url);
  url.searchParams.set("limit", String(source.maxItems));
  url.searchParams.set("ordering", "-published_at");
  const data = await fetchJson<SpaceflightResponse>(url.toString(), context);
  if ((data.results?.length ?? 0) >= source.maxItems) context.reportIssue?.("upstream-cap");
  return projectSpaceflight(data, source, context.now);
}
