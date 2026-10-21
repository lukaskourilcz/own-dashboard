import type {
  SourceConfig,
  SourceFetchContext,
  SourceItem
} from "../types";
import { parseRssFeed } from "./rss";
import { fetchText } from "./util";

/**
 * arXiv's query API answered Vercel in more than the default 8 s on the first native night
 * (21 October 2026), while every other source answered in about a second. The collection gives one
 * free source 25 s, so the request may use 20 of them.
 */
export const ARXIV_REQUEST_TIMEOUT_MS = 20_000;

export async function fetchArxiv(
  source: SourceConfig,
  context: SourceFetchContext
): Promise<SourceItem[]> {
  const url = new URL(source.url);
  url.searchParams.set("search_query", source.query ?? "cat:cs.AI");
  url.searchParams.set("sortBy", "submittedDate");
  url.searchParams.set("sortOrder", "descending");
  url.searchParams.set("max_results", String(source.maxItems));
  const items = await parseRssFeed(await fetchText(url.toString(), context, { timeoutMs: ARXIV_REQUEST_TIMEOUT_MS }), source, context.now);
  if (items.length >= source.maxItems) context.reportIssue?.("upstream-cap");
  return items;
}
