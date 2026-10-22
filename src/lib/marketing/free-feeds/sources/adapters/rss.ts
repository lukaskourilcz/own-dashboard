import Parser from "rss-parser";
import type {
  SourceConfig,
  SourceFetchContext,
  SourceItem
} from "../types";
import { fetchText, makeItem } from "./util";

const parser = new Parser({
  timeout: 10_000,
  customFields: { item: [["media:content", "mediaContent", { keepArray: true }], ["media:thumbnail", "mediaThumbnail", { keepArray: true }]] }
});

type MediaElement = { $?: { url?: string; type?: string; medium?: string } };

export interface RssItem {
  guid?: string;
  id?: string;
  link?: string;
  title?: string;
  contentSnippet?: string;
  "content:encoded"?: string;
  content?: string;
  summary?: string;
  isoDate?: string;
  pubDate?: string;
  creator?: string;
  author?: string;
  enclosure?: { url?: string; type?: string };
  mediaContent?: MediaElement[];
  mediaThumbnail?: MediaElement[];
}

const IMAGE_PATH = /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i;

/** First image the feed itself names: enclosure, media:content, then media:thumbnail. Never fetched. */
export function rssImageUrl(item: RssItem): string | undefined {
  const isImage = (url: string | undefined, type?: string, medium?: string) =>
    Boolean(url) && (type?.startsWith("image/") || medium === "image" || (!type && !medium && IMAGE_PATH.test(url ?? "")));
  if (isImage(item.enclosure?.url, item.enclosure?.type)) return item.enclosure?.url;
  const content = item.mediaContent?.find((media) => isImage(media.$?.url, media.$?.type, media.$?.medium));
  if (content?.$?.url) return content.$.url;
  return item.mediaThumbnail?.find((media) => Boolean(media.$?.url))?.$?.url;
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
      summary: item["content:encoded"]?.trim() || item.content?.trim() || item.contentSnippet || item.summary,
      publishedAt: item.isoDate ?? item.pubDate,
      // isoDate is normalised to UTC; the written pubDate still shows a day-only "00:00:00 -0400".
      dateText: item.pubDate,
      author: item.creator ?? item.author,
      externalId: item.guid ?? item.id,
      imageUrl: rssImageUrl(item)
    },
    source,
    now
  );
}

/** Bare `&` in a URL query (`?w=1&dpr=2`) is the usual reason a real feed is not well-formed XML. */
export function escapeBareAmpersands(xml: string): string {
  return xml.replace(/&(?!(?:[A-Za-z][A-Za-z0-9]{1,31}|#[0-9]{1,7}|#x[0-9A-Fa-f]{1,6});)/g, "&amp;");
}

/** The feed's raw entries (RSS items or Atom entries), before projection. */
export async function parseFeedEntries(xml: string): Promise<RssItem[]> {
  // Well-formed feeds parse untouched; one repaired retry covers unescaped query ampersands.
  const feed = await parser.parseString(xml).catch(() => parser.parseString(escapeBareAmpersands(xml)));
  return (feed.items as RssItem[] | undefined) ?? [];
}

export async function parseRssFeed(
  xml: string,
  source: SourceConfig,
  now: Date
): Promise<SourceItem[]> {
  return (await parseFeedEntries(xml))
    .map((item) => projectRssItem(item, source, now))
    .filter((item): item is SourceItem => item !== null);
}

export async function fetchRss(
  source: SourceConfig,
  context: SourceFetchContext
): Promise<SourceItem[]> {
  return parseRssFeed(await fetchText(source.url, context), source, context.now);
}
