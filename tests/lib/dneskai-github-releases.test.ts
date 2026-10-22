import { describe, expect, it, vi } from 'vitest';
import { collectNativeDneskaiFeed } from '@/lib/marketing/dneskai-native-feed';
import { DNESKAI_SOURCES } from '@/lib/marketing/dneskai-registry';
import { GITHUB_RELEASE_FEED_MAX_BYTES } from '@/lib/marketing/free-feeds/sources/adapters/github';
vi.mock('server-only', () => ({}));

// Audit C15: GitHub releases come from the public releases.atom feeds, not the token-limited REST API.
const now = new Date('2026-10-14T12:00:00Z'), since = '2026-10-13T00:00:00Z';
const signal = new AbortController().signal;
const resolve = async () => ['140.82.121.4'];
const source = DNESKAI_SOURCES.find(row => row.id === 'github-ai-releases')!;
const entry = (repo: string, tag: string, updated: string, title = tag) => `<entry><id>tag:github.com,2008:Repository/${repo}/${tag}</id><updated>${updated}</updated>`
  + `<link rel="alternate" type="text/html" href="https://github.com/${repo}/releases/tag/${tag}"/><title>${title}</title>`
  + `<content type="html">&lt;p&gt;Offline notes for ${tag}&lt;/p&gt;</content><author><name>github-actions[bot]</name></author>`
  + `<media:thumbnail height="30" width="30" url="https://avatars.githubusercontent.com/in/15368?s=60&amp;v=4"/></entry>`;
const atom = (entries: string) => new Response(`<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/"><title>Release notes</title>${entries}</feed>`,
  { headers: { 'content-type': 'application/atom+xml; charset=utf-8' } });
const repoOf = (input: RequestInfo | URL) => new URL(String(input)).pathname.replace(/^\/|\/releases\.atom$/g, '');

describe('GitHub releases through public Atom feeds', () => {
 it('reads every repository from github.com without a token and keeps the source identity and cursor key', async () => {
  expect(source).toMatchObject({ id: 'github-ai-releases', kind: 'github', url: 'https://github.com/' });
  const fetcher = vi.fn<typeof fetch>(async input => { const repo = repoOf(input); return atom(repo === 'ollama/ollama' ? entry(repo, 'v0.40.9', '2026-10-14T08:00:00Z') + entry(repo, 'v0.40.8', '2026-10-10T08:00:00Z') : ''); });
  const result = await collectNativeDneskaiFeed(source, since, { now, signal, fetcher, resolve });
  expect(fetcher).toHaveBeenCalledTimes(7);
  for (const [input, init] of fetcher.mock.calls) {
   const url = new URL(String(input));
   expect(url.hostname).toBe('github.com');
   expect(url.pathname).toMatch(/^\/[^/]+\/[^/]+\/releases\.atom$/);
   const headers = new Headers(init?.headers);
   expect(headers.has('authorization')).toBe(false);
   expect(headers.has('x-github-api-version')).toBe(false);
   expect(init).toMatchObject({ redirect: 'manual' });
  }
  // Only the in-window release survives; the author's avatar is never offered as the release picture.
  expect(result.sources[0]).toMatchObject({ sourceId: 'github-ai-releases', status: 'ok', errorCode: null });
  expect(result.sources[0].items).toEqual([expect.objectContaining({
   externalId: 'tag:github.com,2008:Repository/ollama/ollama/v0.40.9', title: 'ollama/ollama v0.40.9',
   url: 'https://github.com/ollama/ollama/releases/tag/v0.40.9', publishedAt: '2026-10-14T08:00:00.000Z', summary: 'Offline notes for v0.40.9',
  })]);
  expect(result.sources[0].items[0]).not.toHaveProperty('imageUrl');
 });
 it('treats a full feed page as complete when its oldest release predates the window', async () => {
  const page = (repo: string, newest: number) => Array.from({ length: 10 }, (_, index) => entry(repo, `v${newest - index}`, new Date(Date.parse('2026-10-14T10:00:00Z') - index * 12 * 3_600_000).toISOString())).join('');
  const covered = await collectNativeDneskaiFeed(source, since, { now, signal, resolve, fetcher: vi.fn<typeof fetch>(async input => atom(repoOf(input) === 'ollama/ollama' ? page('ollama/ollama', 20) : '')) });
  expect(covered.sources[0]).toMatchObject({ status: 'ok', errorCode: null });
  // A whole page inside the window may hide older releases: report the upstream cap so the cursor logic sees it.
  const wide = await collectNativeDneskaiFeed(source, '2026-10-01T00:00:00Z', { now, signal, resolve, fetcher: vi.fn<typeof fetch>(async input => atom(repoOf(input) === 'ollama/ollama' ? page('ollama/ollama', 20) : '')) });
  expect(wide.sources[0]).toMatchObject({ status: 'partial', errorCode: 'upstream-cap' });
 });
 it('keeps the size limit, refuses redirects and other hosts, and reports one failed repository as partial', async () => {
  expect(GITHUB_RELEASE_FEED_MAX_BYTES).toBe(3_000_000);
  const huge = vi.fn<typeof fetch>(async () => new Response('x'.repeat(GITHUB_RELEASE_FEED_MAX_BYTES + 1), { headers: { 'content-type': 'application/atom+xml' } }));
  expect((await collectNativeDneskaiFeed(source, since, { now, signal, resolve, fetcher: huge })).sources[0]).toMatchObject({ status: 'error', errorCode: 'empty-source' });
  // A feed as large as transformers' 1.4 MB one still parses.
  const long = vi.fn<typeof fetch>(async input => atom(repoOf(input) === 'huggingface/transformers' ? entry('huggingface/transformers', 'v5.0.0', '2026-10-14T08:00:00Z').replace('Offline notes', 'x'.repeat(1_400_000)) : ''));
  expect((await collectNativeDneskaiFeed(source, since, { now, signal, resolve, fetcher: long })).sources[0].items).toHaveLength(1);
  const moved = vi.fn<typeof fetch>(async input => repoOf(input) === 'ollama/ollama' ? atom(entry('ollama/ollama', 'v1', '2026-10-14T08:00:00Z')) : new Response(null, { status: 301, headers: { location: 'https://evil.example/releases.atom' } }));
  const partial = await collectNativeDneskaiFeed(source, since, { now, signal, resolve, fetcher: moved });
  expect(partial.sources[0]).toMatchObject({ status: 'partial', errorCode: 'fetch-failed' });
  expect(partial.sources[0].items.map(item => item.title)).toEqual(['ollama/ollama v1']);
  expect(moved.mock.calls.every(([input]) => new URL(String(input)).hostname === 'github.com')).toBe(true);
  await expect(collectNativeDneskaiFeed({ ...source, url: 'https://api.github.com/' }, since, { now, signal, resolve })).rejects.toThrow('binding');
 });
});
