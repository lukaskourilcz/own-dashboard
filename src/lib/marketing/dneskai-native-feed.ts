import 'server-only';
import { DneskaiFeedRequestSchema, DneskaiFeedResponseSchema, type DneskaiSource } from './dneskai-contracts';
import registry from './free-feeds/registry.json';
import { SourceConfigSchema, SourceItemSchema } from './free-feeds/sources/types';
import { fetchSource } from './free-feeds/sources/adapters';
import { parseSafeHttpsUrl, SourceHttpError } from './free-feeds/security/url';

const sources = registry.sources.map(source => SourceConfigSchema.parse(source));
/** Feed configuration is code-owned. Source content cannot authorize another network host. */
export const DNESKAI_NATIVE_FEED_IDS = Object.freeze(sources.map(source => source.id));

/** Reuses Quorum's free-feed adapters. No state, credentials, model calls or publication. */
export async function collectNativeDneskaiFeed(source: DneskaiSource, since: string, options: {
  now?: Date; signal: AbortSignal; fetcher?: typeof fetch;
  resolve?: (hostname: string) => Promise<string[]>;
}) {
  const query = DneskaiFeedRequestSchema.parse({ action: 'collect', sourceIds: [source.id], since, maxItems: source.maxItems });
  const now = options.now ?? new Date();
  const configured = sources.find(row => row.id === source.id);
  if (!configured || configured.url !== source.url || configured.kind !== source.kind || source.maxItems > configured.maxItems) {
    throw new Error('collection-native-binding-invalid');
  }
  if (Date.parse(query.since) > now.getTime()) throw new Error('collection-window-invalid');
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(40_000)]);
  const issues = new Set<string>();
  const items: Array<{ externalId: string; title: string; url: string; publishedAt: string | null; summary: string; fetchedAt: string; imageUrl?: string; dateEstimated?: true }> = [];
  const envelope = (status: 'ok' | 'partial' | 'error', errorCode: string | null) => DneskaiFeedResponseSchema.parse({
    schemaVersion: 'dneskai-feed/1', sources: [{ sourceId: source.id, status, errorCode, items: items.slice(0, source.maxItems) }],
  });
  if (!configured.enabled) return envelope('error', 'source-disabled');
  try {
    signal.throwIfAborted();
    const raw = await fetchSource({ ...configured, maxItems: Math.min(50, source.maxItems + 1) }, {
      // All built-in API paths remain on the source's exact host. Redirects are prohibited.
      allowHosts: [new URL(configured.url).hostname], now, since: new Date(query.since), signal, allowPaidReaders: false,
      fetchImpl: options.fetcher, resolveImpl: options.resolve, reportIssue: code => { issues.add(code); },
    });
    // A deadline that fired after something was read (during HTML article enrichment, or after some
    // GitHub repositories or HN stories answered) keeps what was read. The timeout code makes the
    // result partial, so the source cursor stays put and the next run reads the same window again.
    if (signal.aborted) {
      if (!raw.length) signal.throwIfAborted();
      issues.add('collection-timeout');
    }
    if (!raw.length) return envelope('error', issues.has('reader-disabled') ? 'reader-disabled' : 'empty-source');
    const ids = new Set<string>(), urls = new Set<string>();
    for (const value of raw) {
      const parsed = SourceItemSchema.safeParse(value);
      if (!parsed.success || parsed.data.sourceId !== source.id || parsed.data.externalId.length > 300) { issues.add('invalid-item'); continue; }
      const item = parsed.data;
      try {
        const url = parseSafeHttpsUrl(item.url);
        if (item.url.length > 2048 || url.hash || url.port && url.port !== '443') throw new Error();
      } catch { issues.add('invalid-item'); continue; }
      if (item.publishedAt && Date.parse(item.publishedAt) > now.getTime()) { issues.add('invalid-date'); continue; }
      if (item.publishedAt && Date.parse(item.publishedAt) <= Date.parse(since)) continue;
      if (ids.has(item.externalId) || urls.has(item.url)) { issues.add('duplicate-item'); continue; }
      ids.add(item.externalId); urls.add(item.url);
      if (item.publishedAt === null) issues.add('unknown-date');
      // Never feed detected source instructions into subsequent classification/editorial prompts.
      if (item.promptInjectionSignals.length) { issues.add('untrusted-instructions'); continue; }
      items.push({ externalId: item.externalId, title: item.title, url: item.url, publishedAt: item.publishedAt, summary: item.summary, fetchedAt: now.toISOString(),
        ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}), ...(item.dateEstimated ? { dateEstimated: true as const } : {}) });
    }
    items.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
    if (items.length >= source.maxItems) issues.add('item-cap');
    // An API that returned its full page, all of it older than the window, covered the window.
    if (!items.length && [...issues].every(code => code === 'upstream-cap')) return envelope('ok', null);
    return envelope(issues.size ? items.length ? 'partial' : 'error' : 'ok', issues.size ? [...issues].sort().join(',') : null);
  } catch (error) {
    // Machine codes only: do not expose publisher bodies, query strings or headers.
    return envelope('error', signal.aborted ? 'collection-timeout' : error instanceof SourceHttpError && error.status === 429 ? 'source-rate-limited' : 'fetch-failed');
  }
}
