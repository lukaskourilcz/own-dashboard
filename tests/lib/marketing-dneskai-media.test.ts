import type { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { candidate } from '@/lib/marketing/dneskai-providers';
import { contentHash } from '@/lib/marketing/hashes';
import { dneskaiCheapIdentity } from '@/lib/marketing/dneskai-registry';
import { inspectDneskaiImage, phashDistance } from '@/lib/marketing/dneskai-media-image';
import { collectDneskaiMedia, createDneskaiMediaLoader, pendingDneskaiMediaCandidates, purgeUnusedDneskaiMedia, type DneskaiMediaDatabase, type DneskaiMediaObjectStore } from '@/lib/marketing/dneskai-media';
import { createMediaDatabase, serviceRpcClient, setTestTime } from './marketing-dneskai-media-db';
import { scene } from './marketing-dneskai-media-fixture';

// OFFLINE: every byte is drawn locally, every request goes to an injected fetcher and DNS resolver.
// Hostnames look like the real CDNs so the host rules are exercised; nothing ever leaves the process.
const owner = '11111111-1111-4111-8111-111111111111';
const project = '22222222-2222-4222-8222-222222222222';
const run = '77777777-7777-4777-8777-777777777777';
const instant = '2026-10-20T21:30:00Z';
const IG = 'https://scontent-prg1-1.cdninstagram.com/v/t51.2885-15/';
let pg: PGlite;
let db: ReturnType<typeof serviceRpcClient>;
const client = () => db as unknown as DneskaiMediaDatabase;
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

class MemoryStore implements DneskaiMediaObjectStore {
  objects = new Map<string, { bytes: Buffer; contentType: string; metadata: Record<string, string> }>();
  puts: string[] = [];
  failRemove = false;
  /** Fails every remove call after this many have succeeded. */
  failRemoveAfter = Infinity;
  removeCalls = 0;
  async put(name: string, bytes: Buffer, contentType: string, metadata: Record<string, string>) {
    this.puts.push(name);
    if (this.objects.has(name)) return 'exists' as const;
    this.objects.set(name, { bytes: Buffer.from(bytes), contentType, metadata });
    return 'stored' as const;
  }
  async get(name: string) { return this.objects.get(name)?.bytes ?? null; }
  async remove(names: readonly string[]) {
    if (this.failRemove || this.removeCalls >= this.failRemoveAfter) throw new Error('offline storage failure');
    this.removeCalls += 1;
    for (const name of names) this.objects.delete(name);
  }
  async sign(names: readonly string[]) { return names.map((name) => `https://storage.test/sign/${name}?token=TEST`); }
}

type Reply = { status?: number; type?: string; body?: Uint8Array | string; location?: string };
class FixtureWeb {
  routes = new Map<string, Reply[]>();
  requests: string[] = [];
  /** Advanced by `step` per request, for the time-budget tests. */
  clock = 0;
  step = 2_000;
  serve(url: string, ...replies: Reply[]) { this.routes.set(url, replies); return this; }
  fetch: typeof fetch = async (input) => {
    const url = String(input);
    this.requests.push(url);
    this.clock += this.step;
    const replies = this.routes.get(url);
    const reply = replies && (replies.length > 1 ? replies.shift()! : replies[0]!);
    if (!reply) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    const body = typeof reply.body === 'string' ? new TextEncoder().encode(reply.body) : reply.body ?? new Uint8Array();
    return new Response(body as BodyInit, { status: reply.status ?? 200, headers: { 'content-type': reply.type ?? 'image/jpeg', 'content-length': String(body.byteLength), ...(reply.location ? { location: reply.location } : {}) } });
  };
  count(url: string) { return this.requests.filter((request) => request === url).length; }
}
const publicDns = async () => ['93.184.216.34'];

async function insertCandidate(sourceId: string, externalId: string, url: string, mediaUrls: string[], patch: Record<string, unknown> = {}, status = 'selected') {
  const row = { ...candidate(sourceId, externalId, `OFFLINE TEST ${externalId}`, `OFFLINE TEST public text ${externalId}`, url, instant, instant, mediaUrls), status, targetDate: '2026-10-21', ...patch };
  const identity = dneskaiCheapIdentity(row);
  await pg.query('insert into marketing_dneskai_candidates(id,user_id,project_id,run_id,candidate,canonical_url_hash,normalized_text_hash,content_hash,status,target_date) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [row.id, owner, project, run, JSON.stringify(row), contentHash(identity.canonicalUrl), contentHash(identity.normalizedText), row.contentHash, status, status === 'selected' ? '2026-10-21' : null]);
  return row.id;
}
const assetsOf = async (candidateId: string) => (await pg.query<{ position: number; sha256: string; origin_kind: string; origin_url: string; credit: string; width: number; height: number; mime: string; duplicate_of_asset_id: string | null; id: string }>(
  'select l.position,a.sha256,l.origin_kind,l.origin_url,l.credit,a.width,a.height,a.mime,a.duplicate_of_asset_id,a.id from marketing_media_asset_links l join marketing_media_assets a on a.id=l.asset_id where l.candidate_id=$1 order by l.position', [candidateId])).rows;

let A: Buffer, B: Buffer, C: Buffer, heroSmall: Buffer, heroLarge: Buffer, chart: Buffer, tiny: Buffer;
beforeAll(async () => {
  pg = await createMediaDatabase([owner], [{ id: project, owner }], instant);
  await pg.query("insert into marketing_dneskai_runs(id,user_id,project_id,date,target_date) values($1,$2,$3,'2026-10-20','2026-10-21')", [run, owner, project]);
  db = serviceRpcClient(pg);
  [A, B, C, heroSmall, heroLarge, chart, tiny] = await Promise.all([
    scene(0, 1440, 1800).jpeg({ quality: 90 }).toBuffer(), scene(1, 1080, 1350).jpeg({ quality: 90 }).toBuffer(), scene(4, 1080, 1350).webp().toBuffer(),
    scene(2, 1200, 900).jpeg({ quality: 70 }).toBuffer(), scene(2, 2400, 1800).jpeg({ quality: 92 }).toBuffer(), scene(3, 1200, 700).png().toBuffer(), scene(0, 200, 200).png().toBuffer(),
  ]);
}, 60000);
afterAll(async () => { await pg?.close(); });

describe('collectDneskaiMedia: selected candidates, stored once, in order, with credit', () => {
  it('stores every picture of an Instagram carousel, not only the first, and a repeat downloads nothing', async () => {
    const web = new FixtureWeb().serve(`${IG}display.jpg?oe=TEST`, { body: A }).serve(`${IG}child-1.jpg?oe=TEST`, { body: A })
      .serve(`${IG}child-2.jpg?oe=TEST`, { body: B, type: 'image/jpeg' }).serve(`${IG}child-3.webp?oe=TEST`, { body: C, type: 'image/webp' });
    const id = await insertCandidate('instagram:mosseri', 'OFFLINE-carousel', 'https://www.instagram.com/p/OFFLINE/', ['display.jpg', 'child-1.jpg', 'child-2.jpg', 'child-3.webp'].map((name) => `${IG}${name}?oe=TEST`), { instagram: { ownerUsername: 'mosseri', mediaType: 'carousel' } });
    const store = new MemoryStore();
    const result = await collectDneskaiMedia(client(), owner, project, [id], { fetchImpl: web.fetch, resolveImpl: publicDns, store });
    expect(result).toEqual({ complete: true, candidates: [{ candidateId: id, status: 'complete', assets: 3, downloaded: 4, reused: 1, skipped: [{ position: 1, code: 'media-duplicate-bytes' }] }] });
    const rows = await assetsOf(id);
    expect(rows.map((row) => [row.position, row.sha256, row.origin_kind, row.credit])).toEqual([
      [0, sha(A), 'instagram-display', 'Foto: @mosseri'], [2, sha(B), 'instagram-child', 'Foto: @mosseri'], [3, sha(C), 'instagram-child', 'Foto: @mosseri']]);
    expect(rows.map((row) => [row.width, row.height, row.mime])).toEqual([[1440, 1800, 'image/jpeg'], [1080, 1350, 'image/jpeg'], [1080, 1350, 'image/webp']]);
    // The original bytes, unchanged, under <owner>/<sha256>.<ext>.
    expect([...store.objects.keys()].sort()).toEqual([`${owner}/${sha(A)}.jpg`, `${owner}/${sha(B)}.jpg`, `${owner}/${sha(C)}.webp`].sort());
    expect(store.objects.get(`${owner}/${sha(A)}.jpg`)).toEqual({ bytes: A, contentType: 'image/jpeg', metadata: { ownerId: owner, sha256: sha(A) } });
    const before = web.requests.length;
    expect(await collectDneskaiMedia(client(), owner, project, [id], { fetchImpl: web.fetch, resolveImpl: publicDns, store })).toMatchObject({ complete: true, candidates: [{ status: 'complete', assets: 3, downloaded: 0 }] });
    expect(web.requests.length).toBe(before);
  });

  it('reads a feed article once, keeps publisher order, prefers the original upload and marks the smaller copy', async () => {
    const page = 'https://www.theverge.com/2026/10/20/offline-test';
    const html = `<html><head><meta property="og:image" content="https://www.theverge.com/wp-content/uploads/2026/10/hero.jpg?quality=90&amp;strip=all"></head><body><article>
      <p>OFFLINE TEST body paragraph.</p><figure><img src="https://duet-cdn.vox-cdn.com/thumbor/hero-2400.jpg" alt="OFFLINE"></figure>
      <img src="/figure-small.png" alt="OFFLINE small"><figure><img src="/chart.png" alt="OFFLINE chart"></figure></article></body></html>`;
    const web = new FixtureWeb().serve(page, { body: html, type: 'text/html; charset=utf-8' })
      .serve('https://www.theverge.com/wp-content/uploads/2026/10/hero.jpg', { status: 404, type: 'text/html', body: 'gone' })
      .serve('https://www.theverge.com/wp-content/uploads/2026/10/hero.jpg?quality=90&strip=all', { body: heroSmall })
      .serve('https://duet-cdn.vox-cdn.com/thumbor/hero-2400.jpg', { body: heroLarge })
      .serve('https://www.theverge.com/figure-small.png', { body: tiny, type: 'image/png' })
      .serve('https://www.theverge.com/chart.png', { body: chart, type: 'image/png' });
    const id = await insertCandidate('the-verge', 'OFFLINE-verge', page, ['https://www.theverge.com/wp-content/uploads/2026/10/hero.jpg']);
    const store = new MemoryStore();
    const result = await collectDneskaiMedia(client(), owner, project, [id], { fetchImpl: web.fetch, resolveImpl: publicDns, store });
    expect(result.candidates[0]).toMatchObject({ status: 'complete', assets: 3, skipped: [{ position: 2, code: 'media-excluded-small' }] });
    expect(web.count(page)).toBe(1);
    const rows = await assetsOf(id);
    expect(rows.map((row) => [row.position, row.origin_kind, row.origin_url, row.credit])).toEqual([
      [0, 'og-image', 'https://www.theverge.com/wp-content/uploads/2026/10/hero.jpg?quality=90&strip=all', 'Obrázek: The Verge'],
      [1, 'article-figure', 'https://duet-cdn.vox-cdn.com/thumbor/hero-2400.jpg', 'Obrázek: The Verge'],
      [3, 'article-figure', 'https://www.theverge.com/chart.png', 'Obrázek: The Verge']]);
    expect(phashDistance((await inspectDneskaiImage(heroSmall)).phash, (await inspectDneskaiImage(heroLarge)).phash)).toBeLessThanOrEqual(6);
    expect(rows[0]!.duplicate_of_asset_id).toBe(rows[1]!.id);
    expect(rows[1]!.duplicate_of_asset_id).toBeNull();
    expect(rows[2]!.duplicate_of_asset_id).toBeNull();
    const requests = web.requests.length;
    await collectDneskaiMedia(client(), owner, project, [id], { fetchImpl: web.fetch, resolveImpl: publicDns, store });
    expect(web.requests.length).toBe(requests);
  });

  it('stores a picture used by two candidates once and links it to both', async () => {
    const page = 'https://deepmind.google/discover/blog/offline-test/';
    const web = new FixtureWeb().serve(page, { body: '<html><head><meta property="og:image" content="https://lh3.googleusercontent.com/OFFLINE=w2400"></head><body></body></html>', type: 'text/html' })
      .serve('https://lh3.googleusercontent.com/OFFLINE=w2400', { body: B });
    const id = await insertCandidate('deepmind-blog', 'OFFLINE-deepmind', page, []);
    const store = new MemoryStore();
    store.objects.set(`${owner}/${sha(B)}.jpg`, { bytes: B, contentType: 'image/jpeg', metadata: {} });
    const result = await collectDneskaiMedia(client(), owner, project, [id], { fetchImpl: web.fetch, resolveImpl: publicDns, store });
    expect(result.candidates[0]).toMatchObject({ status: 'complete', assets: 1, downloaded: 1, reused: 1 });
    expect(store.puts).toEqual([]);
    expect((await pg.query('select * from marketing_media_assets where sha256=$1', [sha(B)])).rows).toHaveLength(1);
    expect((await assetsOf(id))[0]).toMatchObject({ sha256: sha(B), credit: 'Obrázek: Google DeepMind', origin_kind: 'og-image' });
  });

  it('never fetches for an unselected candidate, an off-CDN link or a private address', async () => {
    const web = new FixtureWeb().serve(`${IG}held.jpg`, { body: A });
    const held = await insertCandidate('instagram:mosseri', 'OFFLINE-held', 'https://www.instagram.com/p/OFFLINE-held/', [`${IG}held.jpg`], {}, 'new');
    const odd = await insertCandidate('instagram:mosseri', 'OFFLINE-odd', 'https://www.instagram.com/p/OFFLINE-odd/', ['https://images.example.org/elsewhere.jpg', 'https://internal.cdninstagram.com/private.jpg']);
    const resolve = async (host: string) => host === 'internal.cdninstagram.com' ? ['10.0.0.5'] : ['93.184.216.34'];
    const result = await collectDneskaiMedia(client(), owner, project, [held, odd], { fetchImpl: web.fetch, resolveImpl: resolve, store: new MemoryStore() });
    expect(result.candidates).toEqual([
      { candidateId: held, status: 'not-selected', assets: 0, downloaded: 0, reused: 0, skipped: [] },
      { candidateId: odd, status: 'failed', assets: 0, downloaded: 0, reused: 0, skipped: [{ position: 0, code: 'media-host-not-publisher' }, { position: 1, code: 'media-host-unsafe' }] }]);
    expect(web.requests).toEqual([]);
  });

  it('retries a transient failure on the next pass and keeps an expired Instagram link visible', async () => {
    const web = new FixtureWeb().serve(`${IG}flaky.jpg`, { status: 503, type: 'text/plain', body: 'busy' }, { body: C, type: 'image/webp' })
      .serve(`${IG}expired.jpg`, { status: 403, type: 'text/plain', body: 'URL signature expired' });
    const id = await insertCandidate('instagram:meta.ai', 'OFFLINE-flaky', 'https://www.instagram.com/p/OFFLINE-flaky/', [`${IG}flaky.jpg`, `${IG}expired.jpg`], { instagram: { ownerUsername: 'meta.ai', mediaType: 'video' } });
    const store = new MemoryStore();
    const first = await collectDneskaiMedia(client(), owner, project, [id], { fetchImpl: web.fetch, resolveImpl: publicDns, store, concurrency: 1 });
    expect(first).toMatchObject({ complete: false, candidates: [{ status: 'pending', assets: 0, skipped: [{ position: 0, code: 'media-http-503' }, { position: 1, code: 'media-http-403' }] }] });
    const second = await collectDneskaiMedia(client(), owner, project, [id], { fetchImpl: web.fetch, resolveImpl: publicDns, store });
    expect(second).toMatchObject({ complete: true, candidates: [{ status: 'partial', assets: 1, skipped: [{ position: 1, code: 'media-http-403' }] }] });
    // The 403 is final: it is not requested again.
    expect(web.count(`${IG}expired.jpg`)).toBe(1);
    expect(web.count(`${IG}flaky.jpg`)).toBe(2);
    expect((await assetsOf(id))[0]).toMatchObject({ sha256: sha(C), credit: 'Foto: @meta.ai' });
  });

  it('retries an unreadable article page at most three times, then keeps the feed image', async () => {
    const page = 'https://openai.com/index/offline-test/';
    const web = new FixtureWeb().serve(page, { status: 503, type: 'text/plain', body: 'busy' }).serve('https://images.ctfassets.net/OFFLINE/feed.jpg', { body: heroLarge });
    const id = await insertCandidate('openai-blog', 'OFFLINE-openai', page, ['https://images.ctfassets.net/OFFLINE/feed.jpg']);
    const store = new MemoryStore();
    const deps = { fetchImpl: web.fetch, resolveImpl: publicDns, store };
    expect((await collectDneskaiMedia(client(), owner, project, [id], deps)).candidates[0]).toMatchObject({ status: 'pending', skipped: [{ position: -1, code: 'media-page-http-503' }] });
    expect((await collectDneskaiMedia(client(), owner, project, [id], deps)).candidates[0]).toMatchObject({ status: 'pending' });
    expect(web.count('https://images.ctfassets.net/OFFLINE/feed.jpg')).toBe(0);
    expect((await collectDneskaiMedia(client(), owner, project, [id], deps)).candidates[0]).toMatchObject({ status: 'complete', assets: 1 });
    expect(web.count(page)).toBe(3);
    expect((await pg.query('select page_status,page_attempts,page_error from marketing_media_collections where candidate_id=$1', [id])).rows[0]).toEqual({ page_status: 'failed', page_attempts: 3, page_error: 'media-page-http-503' });
    expect((await assetsOf(id))[0]).toMatchObject({ origin_kind: 'feed-image', credit: 'Obrázek: OpenAI' });
  });

  it('stops starting downloads when the time budget runs short and continues on the next call', async () => {
    const urls = ['a', 'b', 'c'].map((name) => `${IG}budget-${name}.jpg`);
    const web = new FixtureWeb().serve(urls[0]!, { body: A }).serve(urls[1]!, { body: B }).serve(urls[2]!, { body: C, type: 'image/webp' });
    const id = await insertCandidate('instagram:robotic', 'OFFLINE-budget', 'https://www.instagram.com/p/OFFLINE-budget/', urls);
    const store = new MemoryStore();
    const deps = { fetchImpl: web.fetch, resolveImpl: publicDns, store, concurrency: 1, now: () => web.clock, budgetMs: 21_000 };
    const first = await collectDneskaiMedia(client(), owner, project, [id], deps);
    expect(first).toMatchObject({ complete: false, candidates: [{ status: 'pending', assets: 1, downloaded: 1 }] });
    const second = await collectDneskaiMedia(client(), owner, project, [id], { ...deps, budgetMs: 60_000 });
    expect(second).toMatchObject({ complete: true, candidates: [{ status: 'complete', assets: 3, downloaded: 2 }] });
    expect(urls.map((url) => web.count(url))).toEqual([1, 1, 1]);
  });

  it('tells the scheduler which selected candidates still owe media, until none is left', async () => {
    expect(await pendingDneskaiMediaCandidates(client(), owner, project)).toEqual([]);
    const web = new FixtureWeb().serve(`${IG}late.jpg`, { body: A });
    const fresh = await insertCandidate('instagram:technology', 'OFFLINE-late', 'https://www.instagram.com/p/OFFLINE-late/', [`${IG}late.jpg`]);
    const stale = await insertCandidate('instagram:technology', 'OFFLINE-stale', 'https://www.instagram.com/p/OFFLINE-stale/', [`${IG}stale.jpg`]);
    await pg.query("update marketing_dneskai_candidates set target_date='2026-10-19' where id=$1", [stale]);
    expect(await pendingDneskaiMediaCandidates(client(), owner, project)).toEqual([fresh]);
    await collectDneskaiMedia(client(), owner, project, [fresh], { fetchImpl: web.fetch, resolveImpl: publicDns, store: new MemoryStore() });
    expect(await pendingDneskaiMediaCandidates(client(), owner, project)).toEqual([]);
    expect(web.count(`${IG}stale.jpg`)).toBe(0);
  });

  it('refuses malformed input before any work', async () => {
    await expect(collectDneskaiMedia(client(), 'not-a-uuid', project, ['x'])).rejects.toThrow();
    await expect(collectDneskaiMedia(client(), owner, project, [])).rejects.toThrow();
    await expect(collectDneskaiMedia(client(), owner, project, ['a', 'a'])).rejects.toThrow();
    await expect(collectDneskaiMedia(client(), owner, project, Array.from({ length: 9 }, (_, index) => `c${index}`))).rejects.toThrow();
  });

  // Distinct sizes per seed, so no two of these tests share bytes.
  const pictures = (count: number, seed: number) => Promise.all(Array.from({ length: count }, (_, index) => scene(((index + seed) % 5) as 0 | 1 | 2 | 3 | 4, 1000 + 10 * (index + seed), 1000).jpeg({ quality: 80 }).toBuffer()));
  async function slowCarousel(name: string, count: number, web: FixtureWeb, seed: number) {
    const urls = Array.from({ length: count }, (_, index) => `${IG}${name}-${index}.jpg`);
    const bytes = await pictures(count, seed);
    urls.forEach((url, index) => web.serve(url, { body: bytes[index]! }));
    return { id: await insertCandidate('instagram:robotic', `OFFLINE-${name}`, `https://www.instagram.com/p/OFFLINE-${name}/`, urls), urls };
  }

  it('starts no download that could outlast the 120 s claim, whatever budget is left', async () => {
    const web = new FixtureWeb();
    web.step = 10_000;
    const { id, urls } = await slowCarousel('lease', 8, web, 0);
    const deps = { fetchImpl: web.fetch, resolveImpl: publicDns, store: new MemoryStore(), concurrency: 1, now: () => web.clock, budgetMs: 90_000 };
    // Downloads start at 0, 10, …, 50 s into the claim; the seventh would start with 60 s of it left.
    expect(await collectDneskaiMedia(client(), owner, project, [id], deps)).toMatchObject({ complete: false, candidates: [{ status: 'pending', downloaded: 6 }] });
    expect(await collectDneskaiMedia(client(), owner, project, [id], deps)).toMatchObject({ complete: true, candidates: [{ status: 'complete', downloaded: 2 }] });
    expect(urls.map((url) => web.count(url))).toEqual(urls.map(() => 1));
  });

  it('caps the time budget at 90 s', async () => {
    const web = new FixtureWeb();
    web.step = 10_000;
    const first = await slowCarousel('cap-a', 6, web, 10);
    const second = await slowCarousel('cap-b', 6, web, 20);
    const deps = { fetchImpl: web.fetch, resolveImpl: publicDns, store: new MemoryStore(), concurrency: 1, now: () => web.clock, budgetMs: 600_000 };
    // The second candidate starts 60 s in: two downloads fit before 70 s, where 20 s of the 90 s remain.
    expect(await collectDneskaiMedia(client(), owner, project, [first.id, second.id], deps)).toMatchObject({ complete: false, candidates: [{ status: 'complete', downloaded: 6 }, { status: 'pending', downloaded: 2 }] });
    expect(await collectDneskaiMedia(client(), owner, project, [second.id], deps)).toMatchObject({ complete: true, candidates: [{ status: 'complete', downloaded: 4 }] });
  });

  it('leaves a candidate pending when its claim runs out and carries on with the next one', async () => {
    const web = new FixtureWeb();
    const slow = await slowCarousel('slow-upload', 1, web, 30);
    const next = await slowCarousel('after-slow', 1, web, 40);
    const store = new MemoryStore();
    const put = store.put.bind(store);
    let stalls = 1;
    // The upload takes longer than the claim: the database clock moves past its 120 s.
    store.put = async (...args) => { if (stalls-- > 0) await setTestTime(pg, '2026-10-20T21:32:30Z'); return put(...args); };
    const deps = { fetchImpl: web.fetch, resolveImpl: publicDns, store, concurrency: 1 };
    expect(await collectDneskaiMedia(client(), owner, project, [slow.id, next.id], deps)).toEqual({ complete: false, candidates: [
      { candidateId: slow.id, status: 'pending', assets: 0, downloaded: 0, reused: 0, skipped: [{ position: -1, code: 'media-lease-lost' }] },
      { candidateId: next.id, status: 'complete', assets: 1, downloaded: 1, reused: 0, skipped: [] }] });
    // The bytes that landed late are verified and recorded on the next pass, not uploaded twice.
    expect(await collectDneskaiMedia(client(), owner, project, [slow.id], deps)).toMatchObject({ complete: true, candidates: [{ status: 'complete', assets: 1, reused: 1 }] });
    expect(store.objects.size).toBe(2);
    await setTestTime(pg, instant);
  });
});

describe('createDneskaiMediaLoader (LoadDneskaiMediaBytes)', () => {
  it('returns the exact stored bytes and refuses anything that does not hash to the asset', async () => {
    const store = new MemoryStore();
    store.objects.set(`${owner}/${sha(A)}.jpg`, { bytes: A, contentType: 'image/jpeg', metadata: {} });
    store.objects.set(`${owner}/${sha(B)}.jpg`, { bytes: C, contentType: 'image/jpeg', metadata: {} });
    const load = createDneskaiMediaLoader(client(), owner, { store });
    expect((await load(sha(A))).equals(A)).toBe(true);
    await expect(load(sha(B))).rejects.toThrow('media-asset-hash-mismatch');
    await expect(load(sha(C))).rejects.toThrow('media-asset-unavailable');
    await expect(load('f'.repeat(64))).rejects.toThrow('media-asset-unavailable');
    await expect(load('../etc/passwd')).rejects.toThrow('media-asset-unavailable');
    await expect(createDneskaiMediaLoader(client(), '33333333-3333-4333-8333-333333333333', { store })(sha(A))).rejects.toThrow('media-asset-unavailable');
  });
});

describe('purgeUnusedDneskaiMedia', () => {
  it('deletes the bytes of old unreferenced assets, keeps rows and anything a deck draws', async () => {
    const store = new MemoryStore();
    const all = (await pg.query<{ sha256: string; storage_path: string }>('select sha256,storage_path from marketing_media_assets')).rows;
    for (const row of all) store.objects.set(row.storage_path.slice('marketing-media/'.length), { bytes: Buffer.alloc(1), contentType: 'image/jpeg', metadata: {} });
    await pg.query("insert into marketing_revisions(user_id,project_id,brand,revision,content_hash,status) values($1,$2,'dneskai',$3,$4,'review')",
      [owner, project, JSON.stringify({ deck: { schemaVersion: 'dneskai-slides/1', format: 'carousel', slides: [{ type: 'cover-photo', headline: 'OFFLINE', images: [{ slot: 'image-1', assetSha256: sha(A) }], alt: 'OFFLINE' }] } }), 'e'.repeat(64)]);
    expect(await purgeUnusedDneskaiMedia(client(), owner, 30, { store })).toEqual({ purged: 0, errorCode: null });
    await setTestTime(pg, '2026-11-25T03:00:00Z');
    store.failRemove = true;
    expect(await purgeUnusedDneskaiMedia(client(), owner, 30, { store })).toEqual({ purged: 0, errorCode: 'media-purge-storage-failed' });
    expect(Number((await pg.query<{ n: string }>('select count(*) n from marketing_media_assets where purged_at is not null')).rows[0]!.n)).toBe(0);
    store.failRemove = false;
    const result = await purgeUnusedDneskaiMedia(client(), owner, 30, { store });
    expect(result).toEqual({ purged: all.length - 1, errorCode: null });
    expect([...store.objects.keys()]).toEqual([`${owner}/${sha(A)}.jpg`]);
    expect(Number((await pg.query<{ n: string }>('select count(*) n from marketing_media_assets')).rows[0]!.n)).toBe(all.length);
    await expect(createDneskaiMediaLoader(client(), owner, { store })(sha(B))).rejects.toThrow('media-asset-unavailable');
    await expect(purgeUnusedDneskaiMedia(client(), owner, 0, { store })).rejects.toThrow('media-purge-invalid');
  });

  it('keeps the purge mark of a chunk whose bytes were deleted when a later chunk fails', async () => {
    const store = new MemoryStore();
    const ids: string[] = [];
    for (let index = 0; index < 120; index += 1) {
      const digest = createHash('sha256').update(`OFFLINE purge ${index}`).digest('hex');
      const { rows } = await pg.query<{ id: string; storage_path: string }>(`insert into marketing_media_assets(user_id,project_id,sha256,candidate_id,source_id,external_id,origin_url,origin_kind,position,width,height,mime,bytes,storage_path,credit,fetched_at)
        values($1,$2,$3,'offline','offline','offline','https://cdn.publisher.test/x.jpg','og-image',0,1200,900,'image/jpeg',1,$4,'Obrázek: Publisher','2026-09-01T00:00:00Z') returning id,storage_path`, [owner, project, digest, `marketing-media/${owner}/${digest}.jpg`]);
      ids.push(rows[0]!.id);
      store.objects.set(rows[0]!.storage_path.slice('marketing-media/'.length), { bytes: Buffer.alloc(1), contentType: 'image/jpeg', metadata: {} });
    }
    store.failRemoveAfter = 1;
    expect(await purgeUnusedDneskaiMedia(client(), owner, 30, { store })).toEqual({ purged: 100, errorCode: 'media-purge-storage-failed' });
    const marked = await pg.query<{ id: string; storage_path: string }>('select id,storage_path from marketing_media_assets where id=any($1) and purged_at is not null', [ids]);
    expect(marked.rows).toHaveLength(100);
    // Every row still marked has lost its bytes, and every row with bytes is unmarked.
    for (const row of marked.rows) expect(store.objects.has(row.storage_path.slice('marketing-media/'.length))).toBe(false);
    expect(store.objects.size).toBe(20);
    store.failRemoveAfter = Infinity;
    expect(await purgeUnusedDneskaiMedia(client(), owner, 30, { store })).toEqual({ purged: 20, errorCode: null });
    expect(store.objects.size).toBe(0);
  });
});
