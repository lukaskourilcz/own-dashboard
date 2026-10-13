import { createHash } from "node:crypto";
import { sanitizeExternalContent } from "../../security/content";
import { safeFetch, type SafeFetchOptions } from "../../security/url";
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

export function makeItem(
  url: string,
  fields: {
    title?: string;
    summary?: string;
    publishedAt?: string | number | Date;
    author?: string;
    externalId?: string;
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

  return SourceItemSchema.parse({
    sourceId: source.id,
    externalId: fields.externalId ?? stableId(canonical.toString()),
    title: title.text,
    url: canonical.toString(),
    publishedAt: safeIsoDate(fields.publishedAt),
    author,
    summary: summary.text,
    fetchedAt: now.toISOString(),
    weight: source.weight,
    tags: source.tags,
    promptInjectionSignals: [
      ...new Set([...title.promptInjectionSignals, ...summary.promptInjectionSignals])
    ].slice(0, 20)
  });
}

async function sourceFetch(
  url: string,
  context: SourceFetchContext,
  options: Omit<SafeFetchOptions, "allowHosts"> = {}
) {
  return safeFetch(url, { fetchImpl: context.fetchImpl, resolveImpl: context.resolveImpl, maxRedirects: 0, ...options, allowHosts: context.allowHosts, signal: context.signal && options.signal ? AbortSignal.any([context.signal, options.signal]) : context.signal ?? options.signal });
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
