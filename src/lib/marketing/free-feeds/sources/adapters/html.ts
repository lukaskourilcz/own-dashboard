import * as cheerio from "cheerio";
import type {
  SourceConfig,
  SourceFetchContext,
  SourceItem
} from "../types";
import { fetchReadable, linksFromMarkdown } from "./reader";
import { dayUpperBound, fetchText, makeItem, midnightDay, safeImageUrl, type SourceDate } from "./util";

/** cheerio's node type (domhandler's `AnyNode`), derived so the transitive package is not imported. */
type AnyNode = Exclude<Parameters<typeof cheerio.load>[0], string | Buffer | unknown[]>;

/**
 * The number of distinct summaries below which a page is treated as having none.
 *
 * Some publishers wrap their whole index in a single <article>. Taking the enclosing
 * article's text as each link's summary then hands every item the same page-sized blob:
 * anthropic.com/news produced eighteen items sharing one 1,827-character summary, one of them
 * "Download press kit". A summary that is identical across a page is not a summary.
 */
const DISTINCT_SUMMARY_MINIMUM = 2;
/** Article pages read for an exact timestamp and og:image, newest listing entries first. */
export const ARTICLE_ENRICHMENT_LIMIT = 8;
const ARTICLE_ENRICHMENT_BUDGET_MS = 3_500;
const ARTICLE_ENRICHMENT_CONCURRENCY = 4;
const ARTICLE_MAX_BYTES = 600_000;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const MONTH_DAY_YEAR = new RegExp(`\\b${MONTH}\\s+(\\d{1,2}),?\\s+(20\\d{2})\\b`, "i");
const DAY_MONTH_YEAR = new RegExp(`\\b(\\d{1,2})\\s+${MONTH},?\\s+(20\\d{2})\\b`, "i");
const ISO_DAY = /\b(20\d{2})-(\d{2})-(\d{2})\b/;
const URL_DAY = /\/(20\d{2})\/(\d{2})\/(\d{2})\//;
const URL_MONTH = /\/(20\d{2})\/(\d{2})\//;
const NAVIGATION_PATH = /^\/(?:$|about|careers?|jobs|contact|search|login|signup|subscribe|newsletters?|privacy|terms|legal|policies|press(?:-kit)?|tags?|topics?|category|categories|author|authors|page|feed|rss)(?:\/|$)/i;

type ListingDate = SourceDate;
type Draft = { url: string; title: string; rank: number; summary: string; date: ListingDate | undefined; imageUrl: string | undefined };

function monthUpperBound(year: number, month: number, now: Date): ListingDate | undefined {
  if (month < 1 || month > 12) return undefined;
  const start = Date.UTC(year, month - 1, 1);
  if (start > now.getTime()) return undefined;
  return { publishedAt: new Date(Math.min(Date.UTC(year, month, 1) + 12 * 3_600_000 - 1_000, now.getTime())).toISOString(), estimated: true };
}

/**
 * A visible or machine date. A date without a time of day becomes an upper bound, never midnight,
 * and so does a timestamp written at exactly midnight (`2026-10-18T00:00:00.000Z`): anthropic.com
 * writes its day-only dates that way in `article:published_time` and JSON-LD.
 */
export function parseListingDate(value: string | undefined, now: Date): ListingDate | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  const midnight = midnightDay(text);
  if (midnight) return dayUpperBound(midnight.year, midnight.month, midnight.day, now);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) {
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? undefined : { publishedAt: new Date(parsed).toISOString(), estimated: false };
  }
  const iso = ISO_DAY.exec(text);
  if (iso) return dayUpperBound(Number(iso[1]), Number(iso[2]), Number(iso[3]), now);
  const mdy = MONTH_DAY_YEAR.exec(text);
  if (mdy) return dayUpperBound(Number(mdy[3]), MONTHS.indexOf(mdy[1]!.slice(0, 3).toLowerCase()) + 1, Number(mdy[2]), now);
  const dmy = DAY_MONTH_YEAR.exec(text);
  if (dmy) return dayUpperBound(Number(dmy[3]), MONTHS.indexOf(dmy[2]!.slice(0, 3).toLowerCase()) + 1, Number(dmy[1]), now);
  return undefined;
}

function urlDate(url: URL, now: Date): ListingDate | undefined {
  const day = URL_DAY.exec(url.pathname);
  if (day) return dayUpperBound(Number(day[1]), Number(day[2]), Number(day[3]), now);
  const month = URL_MONTH.exec(url.pathname);
  return month ? monthUpperBound(Number(month[1]), Number(month[2]), now) : undefined;
}

const siteKey = (hostname: string) => hostname.toLowerCase().replace(/^www\./, "");
const clean = (value: string) => value.replace(/\s+/g, " ").trim();

/** Same publisher only: the listing host, with or without `www.`. Off-site links are never items. */
export function publisherArticleUrl(href: string, listing: URL): URL | undefined {
  let url: URL;
  try {
    url = new URL(href, listing);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username || url.password || siteKey(url.hostname) !== siteKey(listing.hostname)) return undefined;
  url.hash = "";
  const path = url.pathname.replace(/\/+$/, "");
  if (!path || path === listing.pathname.replace(/\/+$/, "") || NAVIGATION_PATH.test(url.pathname)) return undefined;
  return url;
}

/**
 * Card date in order of authority: `<time>`, a dated permalink, then the text of one leaf element.
 * Leaf text matters because concatenated card text ("...SurgeryJun 29, 2026") hides word breaks.
 */
function dateIn($: cheerio.CheerioAPI, scope: cheerio.Cheerio<AnyNode>, url: URL, now: Date): ListingDate | undefined {
  for (const element of scope.find("time").toArray()) {
    const time = $(element);
    const parsed = parseListingDate(time.attr("datetime"), now) ?? parseListingDate(time.text(), now);
    if (parsed) return parsed;
  }
  const day = URL_DAY.exec(url.pathname);
  if (day) return dayUpperBound(Number(day[1]), Number(day[2]), Number(day[3]), now);
  for (const element of scope.find("*").toArray()) {
    if ($(element).children().length) continue;
    const parsed = parseListingDate($(element).text(), now);
    if (parsed) return parsed;
  }
  return urlDate(url, now);
}

function imageIn($: cheerio.CheerioAPI, scope: cheerio.Cheerio<AnyNode>, base: URL): string | undefined {
  for (const element of scope.find("img").toArray()) {
    const image = $(element);
    const raw = image.attr("src") ?? image.attr("data-src") ?? image.attr("data-lazy-src") ?? image.attr("srcset")?.split(/\s+/)[0];
    if (!raw || raw.startsWith("data:") || /\.svg(?:$|\?)/i.test(raw)) continue;
    try {
      const imageUrl = safeImageUrl(new URL(raw, base).toString());
      if (imageUrl) return imageUrl;
    } catch {
      // A malformed image reference is ignored; the item still stands on its text.
    }
  }
  return undefined;
}

/**
 * The link's own words only. A heading elsewhere in the card is often a section label
 * ("Tubefilter Charts"), so a link without text is dropped rather than titled from its neighbours.
 */
function titleFor(anchor: cheerio.Cheerio<AnyNode>): { title: string; rank: number } {
  const heading = clean(anchor.find("h1,h2,h3,h4,h5,h6,[class*='title'],[class*='Title'],[class*='headline']").first().text());
  if (heading.length >= 8) return { title: heading, rank: 4 };
  const text = clean(anchor.text());
  // An all-caps kicker ("FEATURED") is a label, not a headline.
  if (text.length >= 8 && !/^(read more|learn more|continue reading)$/i.test(text)) return { title: text, rank: /^[^a-z]+$/.test(text) ? 1 : 3 };
  for (const [value, rank] of [[anchor.attr("aria-label"), 2], [anchor.attr("title"), 2], [anchor.find("img[alt]").first().attr("alt"), 0]] as const) {
    const label = clean(value ?? "").replace(/^read(?: more)?:?\s+/i, "");
    // An image's alt text describes the photo; it titles an item only when nothing else does.
    if (label.length >= 8) return { title: label, rank };
  }
  return { title: "", rank: -1 };
}

/**
 * Publisher listing pages carry no feed contract, so each link becomes an item only when it looks
 * like an article: a same-publisher URL, a title of at least eight characters, and a card that
 * holds no other article link. Dates come from `<time datetime>`, visible dates or a dated
 * permalink; a date without a time of day is an upper bound marked `dateEstimated`.
 */
export function projectHtml(
  html: string,
  source: SourceConfig,
  now: Date
): SourceItem[] {
  const $ = cheerio.load(html);
  const listing = new URL(source.url);
  $("script,style,noscript,template,svg,nav").remove();
  const linked = $("a[href]").toArray().flatMap((element) => {
    const url = publisherArticleUrl($(element).attr("href") ?? "", listing);
    return url ? [{ element, url: url.toString() }] : [];
  });
  // Category and tag links ("Safeguards", "Announcements") sit inside article cards. They never
  // wrap a heading and every one of their labels is short; dated permalinks are always articles.
  const byUrl = new Map<string, AnyNode[]>();
  for (const { element, url } of linked) byUrl.set(url, [...(byUrl.get(url) ?? []), element]);
  const taxonomy = new Set([...byUrl].filter(([url, elements]) => !URL_DAY.test(new URL(url).pathname) && elements.every((element) => {
    const anchor = $(element);
    const words = clean(anchor.text()).split(" ").filter(Boolean);
    return !anchor.find("h1,h2,h3,h4,h5,h6").length && words.length <= 3 && clean(anchor.text()).length <= 30;
  })).map(([url]) => url));
  const anchors = linked.filter(({ url }) => !taxonomy.has(url));
  // Memoised per element: neighbouring anchors share ancestors, so each ancestor is scanned once.
  const articleUrlCount = new Map<AnyNode, number>();
  const articleUrlsIn = (scope: cheerio.Cheerio<AnyNode>) => {
    const node = scope.get(0);
    const known = node ? articleUrlCount.get(node) : undefined;
    if (known !== undefined) return known;
    const count = new Set(scope.find("a[href]").toArray().flatMap((link) => {
      const url = publisherArticleUrl($(link).attr("href") ?? "", listing)?.toString();
      return url && !taxonomy.has(url) ? [url] : [];
    })).size;
    if (node) articleUrlCount.set(node, count);
    return count;
  };
  const drafts = new Map<string, Draft>();
  for (const { element, url } of anchors) {
    const anchor = $(element);
    // Widen to the smallest enclosing card that still holds only this article's link.
    let card: cheerio.Cheerio<AnyNode> = anchor;
    for (let depth = 0; depth < 5; depth += 1) {
      const parent = card.parent();
      if (!parent.length || parent.is("body,main,html") || articleUrlsIn(parent) > 1) break;
      card = parent;
    }
    const { title, rank } = titleFor(anchor);
    const paragraph = clean(card.find("p").filter((_, node) => clean($(node).text()) !== title).first().text());
    const draft: Draft = {
      url,
      title,
      rank,
      summary: paragraph.length >= 40 ? paragraph : "",
      date: dateIn($, card, new URL(url), now),
      imageUrl: imageIn($, card, listing)
    };
    const existing = drafts.get(url);
    if (!existing) { drafts.set(url, draft); continue; }
    // Several links (image, kicker, headline) often point at one article: keep the best parts.
    if (draft.rank > existing.rank || (draft.rank === existing.rank && draft.title.length > existing.title.length)) {
      existing.title = draft.title;
      existing.rank = draft.rank;
    }
    existing.summary ||= draft.summary;
    existing.date ??= draft.date;
    existing.imageUrl ??= draft.imageUrl;
  }
  // An index-wide summary is page text, not an item summary.
  const summaries = [...drafts.values()].map((draft) => draft.summary).filter(Boolean);
  const repeated = new Set(summaries.filter((summary, index) => summaries.indexOf(summary) !== index));
  const perItem = new Set(summaries).size >= DISTINCT_SUMMARY_MINIMUM;
  const items: SourceItem[] = [];
  for (const draft of drafts.values()) {
    if (draft.title.length < 8) continue;
    // Only article-shaped links: dated cards, dated permalinks or children of the listing path.
    const path = new URL(draft.url).pathname;
    const underListing = listing.pathname.length > 1 && path.startsWith(listing.pathname.replace(/\/?$/, "/"));
    if (!draft.date && !underListing) continue;
    const item = makeItem(
      draft.url,
      {
        title: draft.title,
        ...(perItem && draft.summary && !repeated.has(draft.summary) ? { summary: draft.summary } : {}),
        ...(draft.date ? { publishedAt: draft.date.publishedAt, dateEstimated: draft.date.estimated } : {}),
        ...(draft.imageUrl ? { imageUrl: draft.imageUrl } : {})
      },
      source,
      now
    );
    if (item) items.push(item);
  }
  return items;
}

const POST_DATE_CLASS = /(?:post|entry|article|publish(?:ed)?)[-_]?date|date[-_]?published/i;

/**
 * Publication time and share image from one article page's own metadata: `article:published_time`,
 * `datePublished` (meta or JSON-LD) and `<time datetime>` give the exact time when they carry a real
 * time of day. A date-only or midnight value in the declared metadata (meta tags, JSON-LD), or else
 * a visible post date, gives a day-precision upper bound. Related-story dates are ignored.
 */
export function articleMetadata(html: string, base: URL, now: Date): { date?: ListingDate; imageUrl?: string } {
  const $ = cheerio.load(html);
  // `declared` marks the page's publication metadata. The first `<time datetime>` may belong to a
  // related story, so it can give an exact time (as before) but never a day bound.
  const candidates: { value: string | undefined; declared: boolean }[] = [
    { value: $("meta[property='article:published_time']").attr("content"), declared: true },
    { value: $("meta[name='article:published_time']").attr("content"), declared: true },
    { value: $("meta[itemprop='datePublished']").attr("content"), declared: true },
    { value: $("time[datetime]").first().attr("datetime"), declared: false }
  ];
  for (const script of $("script[type='application/ld+json']").toArray()) {
    try {
      const stack: unknown[] = [JSON.parse($(script).text())];
      while (stack.length) {
        const value = stack.pop();
        if (Array.isArray(value)) stack.push(...value);
        else if (value && typeof value === "object") {
          const record = value as Record<string, unknown>;
          if (typeof record.datePublished === "string") candidates.push({ value: record.datePublished, declared: true });
          if (Array.isArray(record["@graph"])) stack.push(...record["@graph"]);
        }
      }
    } catch {
      // Malformed JSON-LD is ignored; other metadata may still apply.
    }
  }
  let date: ListingDate | undefined;
  let day: ListingDate | undefined;
  for (const { value, declared } of candidates) {
    const parsed = parseListingDate(value, now);
    if (!parsed || Date.parse(parsed.publishedAt) > now.getTime()) continue;
    if (!parsed.estimated) { date = parsed; break; }
    if (declared) day ??= parsed;
  }
  date ??= day;
  if (!date) {
    for (const element of $("[class]").toArray()) {
      const node = $(element);
      if (node.children().length || !POST_DATE_CLASS.test(node.attr("class") ?? "")) continue;
      date = parseListingDate(node.text(), now);
      if (date) break;
    }
  }
  const og = $("meta[property='og:image']").attr("content") ?? $("meta[name='twitter:image']").attr("content");
  let imageUrl: string | undefined;
  try {
    imageUrl = og ? safeImageUrl(new URL(og, base).toString()) : undefined;
  } catch {
    imageUrl = undefined;
  }
  return { ...(date ? { date } : {}), ...(imageUrl ? { imageUrl } : {}) };
}

/**
 * Reads a bounded number of same-host article pages, newest listing entries first, to replace an
 * estimated or missing date with the article's own timestamp (or a tighter day bound) and to see
 * its og:image. Failures, the sub-budget and off-host URLs leave the listing values untouched;
 * nothing is retried.
 */
export async function enrichArticles(items: readonly SourceItem[], context: SourceFetchContext): Promise<SourceItem[]> {
  const result = [...items];
  const pending = result
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => (item.publishedAt === null || item.dateEstimated) && context.allowHosts.includes(new URL(item.url).hostname)
      // An upper bound already before the window cannot move into it.
      && !(item.publishedAt && context.since && Date.parse(item.publishedAt) <= context.since.getTime()))
    .slice(0, ARTICLE_ENRICHMENT_LIMIT);
  if (!pending.length) return result;
  const budget = AbortSignal.timeout(ARTICLE_ENRICHMENT_BUDGET_MS);
  const signal = context.signal ? AbortSignal.any([context.signal, budget]) : budget;
  let next = 0;
  const worker = async () => {
    for (;;) {
      const entry = pending[next++];
      if (!entry || signal.aborted) return;
      try {
        const html = await fetchText(entry.item.url, { ...context, signal }, { maxBytes: ARTICLE_MAX_BYTES });
        const meta = articleMetadata(html, new URL(entry.item.url), context.now);
        const rest: SourceItem = { ...entry.item };
        delete rest.dateEstimated;
        const current = entry.item.publishedAt ? Date.parse(entry.item.publishedAt) : Infinity;
        // A real time of day always wins (parseListingDate never reports midnight as exact). A day
        // bound is an upper bound like the listing's, so it wins only when it is the tighter one.
        const better = meta.date && (!meta.date.estimated || Date.parse(meta.date.publishedAt) < current) ? meta.date : undefined;
        result[entry.index] = {
          ...(better ? rest : entry.item),
          ...(better ? { publishedAt: better.publishedAt, ...(better.estimated ? { dateEstimated: true as const } : {}) } : {}),
          ...(entry.item.imageUrl || !meta.imageUrl ? {} : { imageUrl: meta.imageUrl })
        };
      } catch {
        // The listing values stand; `dateEstimated` already says the date is an upper bound.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(ARTICLE_ENRICHMENT_CONCURRENCY, pending.length) }, worker));
  return result;
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
  if (items.length > 0) {
    // Newest first by listing date; equal or missing dates keep the publisher's listing order.
    const ordered = [...items].sort((left, right) => (right.publishedAt ?? "").localeCompare(left.publishedAt ?? ""));
    return enrichArticles(ordered.slice(0, Math.max(source.maxItems, 1)), context);
  }

  const markdown = await fetchReadable(source.url, context);
  if (!markdown) return [];
  return linksFromMarkdown(markdown, source.maxItems).flatMap(({ title, url }) => {
    const item = makeItem(url, { title }, source, context.now);
    return item ? [item] : [];
  });
}
