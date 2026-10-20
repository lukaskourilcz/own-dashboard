import { createHash } from "node:crypto";
import { sanitizeExternalContent } from "../../security/content";
import { parseSafeHttpsUrl, safeFetch, type SafeFetchOptions } from "../../security/url";
import {
  SourceItemSchema,
  type SourceConfig,
  type SourceFetchContext,
  type SourceItem
} from "../types";

export function stableId(url: string): string {
  return createHash("sha1").update(url).digest("hex").slice(0, 16);
}

function safeIsoDate(value: string | number | Date | undefined): string | null {
  if (value === undefined) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export type SourceDate = { publishedAt: string; estimated: boolean };

/**
 * The latest instant that still carries a calendar day anywhere (end of the day at UTC-12),
 * clamped to `now`. A day more than UTC+14 ahead of `now` is not a publication date.
 */
export function dayUpperBound(year: number, month: number, day: number, now: Date): SourceDate | undefined {
  const start = Date.UTC(year, month - 1, day);
  const check = new Date(start);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return undefined;
  if (start > now.getTime() + 14 * 3_600_000) return undefined;
  return { publishedAt: new Date(Math.min(start + 36 * 3_600_000 - 1_000, now.getTime())).toISOString(), estimated: true };
}

const MONTH_ABBREVIATIONS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ISO_MIDNIGHT = /^(\d{4})-(\d{2})-(\d{2})T00:00(?::00(?:[.,]0+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/i;
const RFC822_MIDNIGHT = /^(?:[a-z]{3},?\s+)?(\d{1,2})\s+([a-z]{3})[a-z]*\s+(\d{4})\s+00:00(?::00)?(?:\s*(?:[a-z]{1,5}|[+-]\d{4}))?$/i;

/**
 * The calendar day of a timestamp written at exactly midnight, in ISO 8601
 * (`2026-10-18T00:00:00.000Z`, `2026-10-18T00:00:00+02:00`) or RFC 822 (`Sat, 18 Oct 2026 00:00:00 GMT`).
 * A publisher that knows only the day writes it this way, so the value is the start of the day the
 * post appeared on, a lower bound. Read as an exact time it puts a post published later that day
 * before a window it is inside, and the window filter then drops it for good.
 */
export function midnightDay(value: string | undefined): { year: number; month: number; day: number } | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  const iso = ISO_MIDNIGHT.exec(text);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  const rfc = RFC822_MIDNIGHT.exec(text);
  const month = rfc ? MONTH_ABBREVIATIONS.indexOf(rfc[2]!.toLowerCase()) + 1 : 0;
  return rfc && month ? { year: Number(rfc[3]), month, day: Number(rfc[1]) } : undefined;
}

export function makeItem(
  url: string,
  fields: {
    title?: string;
    summary?: string;
    publishedAt?: string | number | Date;
    author?: string;
    externalId?: string;
    imageUrl?: string;
    dateEstimated?: boolean;
    /** The date as the publisher wrote it, when `publishedAt` was already normalised from it. */
    dateText?: string;
  },
  source: SourceConfig,
  now: Date
): SourceItem | null {
  let canonical: URL;
  try {
    canonical = new URL(url);
  } catch {
    return null;
  }
  if (canonical.protocol !== "https:") return null;

  const title = sanitizeExternalContent(fields.title ?? "", 500);
  if (!title.text) return null;
  const summary = sanitizeExternalContent(fields.summary ?? "", 2_000);
  const author = sanitizeExternalContent(fields.author ?? "", 200).text || null;

  const imageUrl = safeImageUrl(fields.imageUrl);
  let publishedAt = safeIsoDate(fields.publishedAt);
  let dateEstimated = Boolean(publishedAt && fields.dateEstimated);
  // A day written as midnight becomes the day's upper bound, like a listing date without a time.
  // Numeric timestamps (HN, Stack Exchange) are real instants and stay exact.
  const written = fields.dateText ?? (typeof fields.publishedAt === "string" ? fields.publishedAt : undefined);
  const day = publishedAt && !dateEstimated ? midnightDay(written) : undefined;
  const bound = day ? dayUpperBound(day.year, day.month, day.day, now) : undefined;
  if (bound) {
    publishedAt = bound.publishedAt;
    dateEstimated = true;
  }
  return SourceItemSchema.parse({
    sourceId: source.id,
    externalId: fields.externalId ?? stableId(canonical.toString()),
    title: title.text,
    url: canonical.toString(),
    publishedAt,
    author,
    summary: summary.text,
    fetchedAt: now.toISOString(),
    weight: source.weight,
    tags: source.tags,
    promptInjectionSignals: [
      ...new Set([...title.promptInjectionSignals, ...summary.promptInjectionSignals])
    ].slice(0, 20),
    ...(imageUrl ? { imageUrl } : {}),
    ...(publishedAt && dateEstimated ? { dateEstimated: true } : {})
  });
}

/** Keep only a bounded public HTTPS image reference. The image itself is never fetched here. */
export function safeImageUrl(value: string | undefined): string | undefined {
  if (!value || value.length > 2048) return undefined;
  try {
    const url = parseSafeHttpsUrl(value.trim());
    if (url.hash || url.toString().length > 2048) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/**
 * Native requests identify the reader. Node's https client sends no User-Agent at all, which
 * several CDNs reject; the token matches the one publishers already see from the bridge.
 */
export const SOURCE_USER_AGENT = "boardlessai-source-shadow/0.1";

async function sourceFetch(
  url: string,
  context: SourceFetchContext,
  options: Omit<SafeFetchOptions, "allowHosts"> = {}
) {
  return safeFetch(url, { fetchImpl: context.fetchImpl, resolveImpl: context.resolveImpl, maxRedirects: 0, ...options, headers: { "user-agent": SOURCE_USER_AGENT, ...options.headers }, allowHosts: context.allowHosts, signal: context.signal && options.signal ? AbortSignal.any([context.signal, options.signal]) : context.signal ?? options.signal });
}

export async function fetchText(
  url: string,
  context: SourceFetchContext,
  options: Omit<SafeFetchOptions, "allowHosts"> = {}
): Promise<string> {
  const response = await sourceFetch(url, context, options);
  return new TextDecoder().decode(response.body);
}

export async function fetchJson<T>(
  url: string,
  context: SourceFetchContext,
  options: Omit<SafeFetchOptions, "allowHosts"> = {}
): Promise<T> {
  return JSON.parse(await fetchText(url, context, options)) as T;
}

export function newestFirst(items: readonly SourceItem[]): SourceItem[] {
  return [...items].sort((left, right) =>
    (right.publishedAt ?? right.fetchedAt).localeCompare(
      left.publishedAt ?? left.fetchedAt
    )
  );
}
