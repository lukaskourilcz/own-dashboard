import type {
  SourceConfig,
  SourceFetchContext,
  SourceItem
} from "../types";
import { parseRssFeed } from "./rss";
import { fetchText } from "./util";

export async function fetchArxiv(
  source: SourceConfig,
  context: SourceFetchContext
): Promise<SourceItem[]> {
  const url = new URL(source.url);
  url.searchParams.set("search_query", source.query ?? "cat:cs.AI");
  url.searchParams.set("sortBy", "submittedDate");
  url.searchParams.set("sortOrder", "descending");
  url.searchParams.set("max_results", String(source.maxItems));
  const items = await parseRssFeed(await fetchText(url.toString(), context), source, context.now);
  if (items.length >= source.maxItems) context.reportIssue?.("upstream-cap");
  return items;
}
