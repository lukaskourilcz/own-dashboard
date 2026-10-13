import * as cheerio from "cheerio";
import type {
  SourceConfig,
  SourceFetchContext,
  SourceItem
} from "../types";
import { fetchReadable, linksFromMarkdown } from "./reader";
import { fetchText, makeItem } from "./util";

/**
 * The number of distinct summaries below which a page is treated as having none.
 *
 * Some publishers wrap their whole index in a single <article>. Taking the enclosing
 * article's text as each link's summary then hands every item the same page-sized blob:
 * anthropic.com/news produced eighteen items sharing one 1,827-character summary, one of them
 * "Download press kit". A summary that is identical across a page is not a summary.
 */
const DISTINCT_SUMMARY_MINIMUM = 2;

export function projectHtml(
  html: string,
  source: SourceConfig,
  now: Date
): SourceItem[] {
  const $ = cheerio.load(html);
  const drafts: Array<{ url: string; title: string; summary: string; publishedAt: string | undefined }> = [];
  $("article a[href]").each((_, element) => {
    const href = $(element).attr("href");
    const title = $(element).text().trim();
    if (!href || title.length < 8) return;
    const article = $(element).closest("article");
    let url: string;
    try {
      url = new URL(href, source.url).toString();
    } catch {
      return;
    }
    drafts.push({
      url,
      title,
      summary: article.text().replace(/\s+/gu, " ").trim(),
      // Anthropic's <time> carries no datetime attribute, so its dates were dropped entirely
      // and every item sank below the dated ones in the digest.
      publishedAt: article.find("time[datetime]").first().attr("datetime")
        ?? (article.find("time").first().text().trim() || undefined)
    });
  });
  // One <article> around the whole index gives every link the same text — and the same first
  // <time>. Both are then page facts wearing item clothes, so both are dropped: an identical
  // summary is noise to rank on, and an identical date is worse than none, because the digest
  // sorts on recency and eighteen items sharing one timestamp would all read as equally fresh.
  const distinct = new Set(drafts.map((draft) => draft.summary)).size;
  const perItem = distinct >= DISTINCT_SUMMARY_MINIMUM;
  const items: SourceItem[] = [];
  for (const draft of drafts) {
    const item = makeItem(
      draft.url,
      {
        title: draft.title,
        ...(perItem && draft.summary ? { summary: draft.summary } : {}),
        ...(perItem ? { publishedAt: draft.publishedAt } : {})
      },
      source,
      now
    );
    if (item) items.push(item);
  }
  return items;
}

export async function fetchHtml(
  source: SourceConfig,
  context: SourceFetchContext
): Promise<SourceItem[]> {
  let items: SourceItem[] = [];
  try {
    items = projectHtml(
      await fetchText(source.url, context, {
        headers: { "user-agent": "boardlessai-source-shadow/0.1" }
      }),
      source,
      context.now
    );
  } catch {
    context.reportIssue?.("fetch-failed");
    // Reader fallback below isolates a blocked or script-rendered publisher.
  }
  if (items.length > 0) return items;

  const markdown = await fetchReadable(source.url, context);
  if (!markdown) return [];
  return linksFromMarkdown(markdown, source.maxItems).flatMap(({ title, url }) => {
    const item = makeItem(url, { title }, source, context.now);
    return item ? [item] : [];
  });
}
