import Parser from "rss-parser";
import type {
  SourceConfig,
  SourceFetchContext,
  SourceItem
} from "../types";
import { fetchText, makeItem } from "./util";

const parser = new Parser({ timeout: 10_000 });

interface RssItem {
  guid?: string;
  id?: string;
  link?: string;
  title?: string;
  contentSnippet?: string;
  content?: string;
  summary?: string;
  isoDate?: string;
  pubDate?: string;
  creator?: string;
  author?: string;
}

export function projectRssItem(
  item: RssItem,
  source: SourceConfig,
  now: Date
): SourceItem | null {
  if (!item.link) return null;
  return makeItem(
    item.link,
    {
      title: item.title,
      summary: item.contentSnippet ?? item.content ?? item.summary,
      publishedAt: item.isoDate ?? item.pubDate,
      author: item.creator ?? item.author,
      externalId: item.guid ?? item.id
    },
    source,
    now
  );
}

export async function parseRssFeed(
  xml: string,
  source: SourceConfig,
  now: Date
): Promise<SourceItem[]> {
  const feed = await parser.parseString(xml);
  return (feed.items as RssItem[] | undefined)
    ?.map((item) => projectRssItem(item, source, now))
    .filter((item): item is SourceItem => item !== null) ?? [];
}

export async function fetchRss(
  source: SourceConfig,
  context: SourceFetchContext
): Promise<SourceItem[]> {
  return parseRssFeed(await fetchText(source.url, context), source, context.now);
}
