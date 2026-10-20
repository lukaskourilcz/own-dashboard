import { describe, it, expect, vi } from 'vitest';
import { collectNativeDneskaiFeed } from '@/lib/marketing/dneskai-native-feed';
import { DNESKAI_SOURCES } from '@/lib/marketing/dneskai-registry';
import { DneskaiFeedResponseSchema } from '@/lib/marketing/dneskai-contracts';
import { ARTICLE_ENRICHMENT_LIMIT, articleMetadata, parseListingDate, projectHtml, publisherArticleUrl } from '@/lib/marketing/free-feeds/sources/adapters/html';
import { parseRssFeed } from '@/lib/marketing/free-feeds/sources/adapters/rss';
import registry from '@/lib/marketing/free-feeds/registry.json';
import { SourceConfigSchema } from '@/lib/marketing/free-feeds/sources/types';
vi.mock('server-only', () => ({}));

const now = new Date('2026-10-20T20:00:00Z'), since = '2026-10-13T20:00:00Z';
const signal = new AbortController().signal;
const resolve = async () => ['93.184.216.34'];
const config = (id: string) => SourceConfigSchema.parse(registry.sources.find(row => row.id === id));
const source = (id: string) => DNESKAI_SOURCES.find(row => row.id === id)!;
const html = (body: string) => new Response(`<!doctype html><html><head><title>Listing</title></head><body>${body}</body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });

// Synthetic markup shaped like the publisher listings observed on 20 October 2026; no publisher text.
const anthropicRows = (count: number) => Array.from({ length: count }, (_, i) => `<li><div><a href="/news/offline-item-${i}"><h3>Offline announcement number ${i}</h3></a></div>
  <div><a href="/news/offline-item-${i}"><p>A bounded offline summary for item ${i}, long enough to count as a summary.</p></a></div>
  <div><a href="/news/policy">Policy</a></div><div><time>Oct ${19 - (i % 6)}, 2026</time></div></li>`).join('');
const anthropicListing = `<nav><a href="/news/announcements">Announcements</a></nav>
  <section><a href="/claude-offline-model"><h4>Introducing an offline model</h4><time>Oct 7, 2026</time></a></section>
  <ul>${anthropicRows(3)}</ul>
  <a href="https://support.example-help.test/how">How to get support</a><a href="/press-kit">Download press kit</a>`;

describe('native publisher HTML extraction', () => {
 it('turns calendar days into upper bounds and keeps exact timestamps exact', () => {
  expect(parseListingDate('Oct 6, 2026', now)).toEqual({ publishedAt: '2026-10-07T11:59:59.000Z', estimated: true });
  expect(parseListingDate('6 October 2026', now)).toEqual({ publishedAt: '2026-10-07T11:59:59.000Z', estimated: true });
  expect(parseListingDate('2026-10-20', now)).toEqual({ publishedAt: now.toISOString(), estimated: true });
  expect(parseListingDate('2026-10-18T16:49:35.513Z', now)).toEqual({ publishedAt: '2026-10-18T16:49:35.513Z', estimated: false });
  expect(parseListingDate('Feb 30, 2026', now)).toBeUndefined();
  expect(parseListingDate('Dec 24, 2026', now)).toBeUndefined();
 });
 it('accepts only same-publisher, non-navigation links', () => {
  const listing = new URL('https://www.anthropic.com/news');
  expect(publisherArticleUrl('/news/item#top', listing)?.toString()).toBe('https://www.anthropic.com/news/item');
  expect(publisherArticleUrl('https://anthropic.com/news/item', listing)).toBeDefined();
  for (const href of ['https://support.claude.com/x', '/press-kit', '/news', 'http://www.anthropic.com/news/x', '/careers/open', 'mailto:a@b.test']) expect(publisherArticleUrl(href, listing)).toBeUndefined();
 });
 it('extracts dated cards, merges duplicate links and drops category, off-site and undated links', () => {
  const items = projectHtml(`<html><body>${anthropicListing}</body></html>`, config('anthropic-news'), now);
  expect(items.map(item => item.url)).toEqual(['https://www.anthropic.com/claude-offline-model', ...[0, 1, 2].map(i => `https://www.anthropic.com/news/offline-item-${i}`)]);
  expect(items[1]).toMatchObject({ title: 'Offline announcement number 0', publishedAt: '2026-10-20T11:59:59.000Z', dateEstimated: true });
  expect(items[1].summary).toContain('bounded offline summary');
  expect(items.every(item => !item.title.includes('Policy'))).toBe(true);
 });
 it('reads dated permalinks, lazy card images and leaf dates hidden by concatenated text', () => {
  const tube = projectHtml(`<div><a href="https://www.tubefilter.com/2026/10/19/offline-story/"><img data-src="/wp-content/uploads/offline.jpg">Creators get an offline story</a></div>
   <div><a href="https://www.tubefilter.com/2026/10/13/charts/"></a><h2>Section Charts</h2></div>`, config('tubefilter'), now);
  expect(tube).toHaveLength(1);
  expect(tube[0]).toMatchObject({ publishedAt: '2026-10-20T11:59:59.000Z', dateEstimated: true, imageUrl: 'https://www.tubefilter.com/wp-content/uploads/offline.jpg' });
  const meta = projectHtml(`<div class="row"><div class="card"><a aria-label="Read Offline research note" href="https://ai.meta.com/blog/offline-note/"><img src="https://scontent.example-cdn.test/i.jpg"></a><div><span>Research</span><a href="https://ai.meta.com/blog/offline-note/">FEATURED</a><a href="https://ai.meta.com/blog/offline-note/">Offline research note title</a></div><div>Jun 29, 2026</div></div>
   <div class="card"><a href="https://ai.meta.com/blog/second-note/">Second offline note title</a><div>Jul 7, 2026</div></div></div>`, config('meta-ai'), now);
  expect(meta.map(item => [item.title, item.publishedAt])).toEqual([['Offline research note title', '2026-06-30T11:59:59.000Z'], ['Second offline note title', '2026-07-08T11:59:59.000Z']]);
  expect(meta[0].imageUrl).toBe('https://scontent.example-cdn.test/i.jpg');
 });
 it('reads article metadata, JSON-LD and visible post dates without trusting related-story dates', () => {
  const base = new URL('https://www.niemanlab.org/2026/10/offline/');
  expect(articleMetadata('<meta property="article:published_time" content="2026-10-18T16:49:35.513Z"><meta property="og:image" content="/images/offline.jpg">', base, now)).toEqual({ date: { publishedAt: '2026-10-18T16:49:35.513Z', estimated: false }, imageUrl: 'https://www.niemanlab.org/images/offline.jpg' });
  expect(articleMetadata('<script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","datePublished":"2026-10-19T19:20:51+00:00"}]}</script>', base, now).date).toEqual({ publishedAt: '2026-10-19T19:20:51.000Z', estimated: false });
  expect(articleMetadata('<div class="embed-relatedstory-date">May 1, 2026</div><div class="roscoe-post-date">October 19, 2026</div>', base, now).date).toEqual({ publishedAt: '2026-10-20T11:59:59.000Z', estimated: true });
  expect(articleMetadata('<meta property="og:image" content="http://insecure.test/a.jpg">', base, now)).toEqual({});
 });
 it('enriches only the newest in-window estimates on the publisher host and keeps listing values on failure', async () => {
  const rows = Array.from({ length: ARTICLE_ENRICHMENT_LIMIT }, (_, i) => `<li><a href="https://www.niemanlab.org/2026/10/offline-${i}/">Offline Nieman story number ${i}</a></li>`).join('')
   + '<li><a href="https://www.niemanlab.org/2026/01/offline-old/">An old offline Nieman story</a></li>';
  const fetcher = vi.fn<typeof fetch>(async input => {
   const url = String(input);
   if (url === 'https://www.niemanlab.org/') return html(`<ul>${rows}</ul>`);
   if (url.endsWith('offline-0/')) return html('<meta property="article:published_time" content="2026-10-19T08:00:00Z"><meta property="og:image" content="https://www.niemanlab.org/images/0.jpg">');
   if (url.endsWith('offline-1/')) return html('<span class="post-date">October 15, 2026</span>');
   return new Response('', { status: 503 });
  });
  const result = await collectNativeDneskaiFeed(source('nieman-lab'), since, { now, signal, fetcher, resolve });
  const items = result.sources[0].items;
  expect(items.find(item => item.url.endsWith('offline-0/'))).toMatchObject({ publishedAt: '2026-10-19T08:00:00.000Z', imageUrl: 'https://www.niemanlab.org/images/0.jpg' });
  expect(items.find(item => item.url.endsWith('offline-0/'))).not.toHaveProperty('dateEstimated');
  expect(items.find(item => item.url.endsWith('offline-1/'))).toMatchObject({ publishedAt: '2026-10-16T11:59:59.000Z', dateEstimated: true });
  expect(items.find(item => item.url.endsWith('offline-5/'))).toMatchObject({ publishedAt: now.toISOString(), dateEstimated: true });
  expect(items.some(item => item.url.endsWith('offline-old/'))).toBe(false);
  // One listing request plus the eight in-window estimates; the January upper bound is before the window.
  expect(fetcher).toHaveBeenCalledTimes(1 + ARTICLE_ENRICHMENT_LIMIT);
  expect(fetcher.mock.calls.every(call => new Headers(call[1]?.headers).get('user-agent') === 'boardlessai-source-shadow/0.1')).toBe(true);
  expect(DneskaiFeedResponseSchema.safeParse(result).success).toBe(true);
 });
});

describe('free image references in the feed contract', () => {
 const rss = (item: string) => `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>t</title><link>https://example.test</link>${item}</channel></rss>`;
 const entry = (extra: string, id = 'a') => `<item><guid>${id}</guid><title>Offline image item ${id}</title><link>https://example.test/${id}</link><pubDate>2026-10-20T08:00:00Z</pubDate>${extra}</item>`;
 it('reads enclosure, media:content and media:thumbnail, ignoring non-image and insecure media', async () => {
  const items = await parseRssFeed(rss(entry('<enclosure url="https://example.test/e.jpg" type="image/jpeg" length="0"/>', 'a')
   + entry('<enclosure url="https://example.test/a.mp3" type="audio/mpeg" length="1"/><media:content url="https://example.test/m.png" medium="image"/>', 'b')
   + entry('<media:thumbnail url="https://example.test/t.webp"/>', 'c')
   + entry('<media:content url="http://example.test/insecure.jpg" type="image/jpeg"/>', 'd')), config('openai-blog'), now);
  expect(items.map(item => item.imageUrl)).toEqual(['https://example.test/e.jpg', 'https://example.test/m.png', 'https://example.test/t.webp', undefined]);
 });
 it('keeps dneskai-feed/1 backward compatible: bridge items without the new fields still parse', () => {
  const base = { schemaVersion: 'dneskai-feed/1', sources: [{ sourceId: 'x', status: 'ok', errorCode: null, items: [{ externalId: 'a', title: 't', url: 'https://example.test/a', publishedAt: null, summary: '', fetchedAt: now.toISOString() }] }] };
  expect(DneskaiFeedResponseSchema.safeParse(base).success).toBe(true);
  expect(DneskaiFeedResponseSchema.safeParse({ ...base, sources: [{ ...base.sources[0], items: [{ ...base.sources[0].items[0], imageUrl: 'https://example.test/i.jpg', dateEstimated: true }] }] }).success).toBe(true);
  expect(DneskaiFeedResponseSchema.safeParse({ ...base, sources: [{ ...base.sources[0], items: [{ ...base.sources[0].items[0], dateEstimated: false }] }] }).success).toBe(false);
 });
 it('treats a full API page that is entirely older than the window as a covered window', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ has_more: true, items: Array.from({ length: 11 }, (_, i) => ({ question_id: i, title: `Offline older question ${i}`, link: `https://example.test/q${i}`, creation_date: 1760000000 - i })) }));
  expect((await collectNativeDneskaiFeed(source('stackexchange-ml'), since, { now, signal, fetcher, resolve })).sources[0]).toMatchObject({ status: 'ok', errorCode: null, items: [] });
 });
});
