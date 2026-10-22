import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { parseContentRevision, parseSourcePacket, revisionReadiness, type ContentRevision } from '@/lib/marketing/contracts';
import { contentHash, revisionHash } from '@/lib/marketing/hashes';
import { INSTAGRAM_PUBLISH_LIMIT_PER_DAY, REEL_CONTAINER_POLL, publicationGate, publishMarketingRevision, type PublishMarketingInput, type PublisherCheckpoint } from '@/lib/marketing/publisher';
import { deck } from './marketing-dneskai-revision-fixture';

// The stand-in Graph server for the Reel path (#165). Nothing leaves the process; every id and token is synthetic.
const now = new Date('2026-10-23T15:00:00Z');
const owner = '11111111-1111-4111-8111-111111111111';
const caption = 'DNESKAi offline QA: Reel ze tří slidů.';
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
let slide: Buffer;
const video = Buffer.from('test-only-mp4-bytes');
beforeAll(async () => { slide = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#2f5ae6' } }).jpeg().toBuffer(); });
type Call = { url: URL; method: string; body: URLSearchParams };

function fixture(options: { graph?: (call: Call) => Response | undefined; reel?: PublishMarketingInput['reel']; videoBytes?: Buffer; publication?: Partial<PublishMarketingInput['publication']> } = {}) {
  const content = { title: 'OFFLINE QA', body: 'Syntetický zdroj.', category: 'tool', difficulty: null, code: null, options: [], answer: null, explanation: null,
    evidence: [{ url: 'https://example.invalid/source', title: 'QA', excerpt: 'QA', checkedAt: now.toISOString() }], image: null };
  const source = parseSourcePacket({ schemaVersion: 'marketing-source/1', brand: 'dneskai', kind: 'article', sourceId: 'article:reel-qa', sourceRevision: 'qa/1', contentHash: contentHash(content),
    canonicalUrl: 'https://dneskai.vercel.app/articles/reel-qa', locale: 'cs', observedAt: now.toISOString(), expiresAt: null, eligible: true, eligibilityReason: 'OFFLINE QA only', content });
  const revision: ContentRevision = parseContentRevision({ schemaVersion: 'marketing-content/2', brand: 'dneskai', title: 'OFFLINE QA reel', caption, format: 'reel',
    sources: [{ sourceId: source.sourceId, sourceRevision: source.sourceRevision, contentHash: source.contentHash }], knowledgeIds: [],
    assets: [1, 2, 3].map((n) => ({ url: `https://assets.example.invalid/slide-${n}.jpg`, sha256: sha(slide), mimeType: 'image/jpeg', width: 1080, height: 1350, alt: `Slide ${n}` })),
    account: { id: '17841400000000001', platform: 'instagram', handle: 'dneskai' }, scheduledAt: now.toISOString(), timeZone: 'Europe/Prague',
    templateVersion: 'qa/1', promptVersion: 'qa/1', model: 'none-offline', traceId: null, deck: deck() });
  const hash = revisionHash(revision);
  const calls: Call[] = []; const checkpoints: PublisherCheckpoint[] = [];
  const served = options.videoBytes ?? video;
  const input: PublishMarketingInput = { now, dryRun: false,
    reel: options.reel === undefined ? { url: 'https://assets.example.invalid/reels/reel.mp4', sha256: sha(video), bytes: video.length } : options.reel,
    revisionRow: { id: '22222222-2222-4222-8222-222222222222', user_id: owner, project_id: null, campaign_id: null, revision, content_hash: hash, status: 'approved', ready: true, approved_at: now.toISOString(), approved_hash: hash, feedback: null, created_at: now.toISOString() },
    publication: { id: '33333333-3333-4333-8333-333333333333', user_id: owner, revision_id: '22222222-2222-4222-8222-222222222222', platform: 'instagram', status: 'claimed', lease_until: '2026-10-23T15:10:00Z', remote_container_id: null, remote_media_id: null, remote_url: null, error_code: null, ...options.publication },
    account: { id: '44444444-4444-4444-8444-444444444444', user_id: owner, brand: 'dneskai', platform: 'instagram', remote_account_id: '17841400000000001', handle: 'dneskai', verified_at: '2026-10-23T06:00:00Z', enabled: true },
    sources: [source],
    config: { enabled: true, apiVersion: 'v99.0', apiVersionVerifiedAt: '2026-10-23T06:00:00Z', loginMode: 'instagram', accessToken: 'TEST-ONLY-TOKEN', tokenExpiresAt: '2026-12-01T00:00:00Z',
      scopes: ['instagram_business_basic', 'instagram_business_content_publish'], approvedAssetHosts: ['assets.example.invalid'], pollIntervalMs: 0, credentialSource: 'database' },
    checkpoint: async (value) => { checkpoints.push(value); }, revalidate: async () => input, wait: async () => undefined,
    fetcher: async (value, init) => {
      const url = new URL(String(value)); const method = init?.method ?? 'GET'; const body = new URLSearchParams(String(init?.body ?? '')); const call = { url, method, body }; calls.push(call);
      if (url.hostname === 'assets.example.invalid') {
        if (url.pathname.endsWith('.mp4')) return new Response(new Uint8Array(served), { headers: { 'Content-Type': 'video/mp4' } });
        return new Response(new Uint8Array(slide), { headers: { 'Content-Type': 'image/jpeg' } });
      }
      const custom = options.graph?.(call); if (custom) return custom;
      if (url.pathname.endsWith('/17841400000000001') && method === 'GET') return Response.json({ id: '1234567', user_id: '17841400000000001', username: 'dneskai' });
      if (url.pathname.endsWith('/content_publishing_limit')) return Response.json({ data: [{ quota_usage: 3, config: { quota_total: 100, quota_duration: 86400 } }] });
      if (url.pathname.endsWith('/media_publish') && method === 'POST') { expect(checkpoints.at(-1)).toMatchObject({ stage: 'publish-intent' }); return Response.json({ id: '90001' }); }
      if (url.pathname.endsWith('/media') && method === 'POST') return Response.json({ id: '300' });
      if (url.pathname.endsWith('/300')) return Response.json({ id: '300', status_code: 'FINISHED' });
      if (url.pathname.endsWith('/90001')) return Response.json({ id: '90001', permalink: 'https://www.instagram.com/reel/offline-qa/' });
      throw new Error(`unexpected offline request ${method} ${url.pathname}`);
    } };
  return { input, calls, checkpoints, posts: () => calls.filter((call) => call.method === 'POST') };
}

describe('a DNESKAi deck Reel (#165)', () => {
  it('is a carousel deck with its slide JPEGs: ready without an MP4 asset and allowed through the gate', () => {
    const { input } = fixture();
    expect(revisionReadiness(input.revisionRow.revision)).toEqual([]);
    expect(publicationGate(input, input.config, now)).toBeNull();
    expect(() => parseContentRevision({ ...input.revisionRow.revision, deck: { ...deck(), format: 'single-image', slides: [{ type: 'single', variant: 'type', headline: 'x', images: [], alt: 'x' }] } })).toThrow();
  });

  it('publishes one REELS container with the video, slide 1 as cover, feed sharing and the caption, then one media_publish', async () => {
    const { input, posts, calls } = fixture();
    expect(await publishMarketingRevision(input)).toEqual({ status: 'published', remoteContainerId: '300', remoteMediaId: '90001', remoteUrl: 'https://www.instagram.com/reel/offline-qa/', errorCode: null });
    const sent = posts();
    expect(sent).toHaveLength(2);
    expect(Object.fromEntries(sent[0]!.body)).toEqual({ caption, media_type: 'REELS', video_url: 'https://assets.example.invalid/reels/reel.mp4', cover_url: 'https://assets.example.invalid/slide-1.jpg', share_to_feed: 'true' });
    expect(Object.fromEntries(sent[1]!.body)).toEqual({ creation_id: '300' });
    // The video was fetched and checked before the container existed.
    const videoRead = calls.findIndex((call) => call.url.pathname.endsWith('.mp4'));
    expect(videoRead).toBeGreaterThanOrEqual(0);
    expect(videoRead).toBeLessThan(calls.indexOf(sent[0]!));
  });

  it('creates nothing without its rendered video or when the video bytes differ', async () => {
    const missing = fixture({ reel: null });
    expect(await publishMarketingRevision(missing.input)).toMatchObject({ status: 'failed', errorCode: 'reel-video-missing' });
    expect(missing.posts()).toEqual([]);
    const changed = fixture({ videoBytes: Buffer.from('other-bytes-of-same-length') });
    expect(await publishMarketingRevision(changed.input)).toMatchObject({ status: 'failed', errorCode: 'asset-hash-mismatch' });
    expect(changed.posts()).toEqual([]);
  });

  it('polls a video container longer, then leaves it pending for the next tick without publishing', async () => {
    const { input, posts, calls } = fixture({ graph: (call) => call.url.pathname.endsWith('/300') ? Response.json({ id: '300', status_code: 'IN_PROGRESS' }) : undefined });
    expect(await publishMarketingRevision(input)).toMatchObject({ status: 'pending', errorCode: 'container-pending', remoteContainerId: '300' });
    expect(calls.filter((call) => call.url.pathname.endsWith('/300'))).toHaveLength(REEL_CONTAINER_POLL.attempts);
    expect(posts().some((call) => call.url.pathname.endsWith('/media_publish'))).toBe(false);
  });

  it(`refuses at ${INSTAGRAM_PUBLISH_LIMIT_PER_DAY} posts a day even when the account reports a higher total`, async () => {
    const { input, posts } = fixture({ graph: (call) => call.url.pathname.endsWith('/content_publishing_limit') ? Response.json({ data: [{ quota_usage: 50, config: { quota_total: 100 } }] }) : undefined });
    expect(await publishMarketingRevision(input)).toMatchObject({ status: 'held', errorCode: 'publishing-quota-exhausted' });
    expect(posts()).toEqual([]);
  });

  it('never publishes twice: after a publish intent it only reads, and matches the Reel listed as REELS', async () => {
    const { input, posts } = fixture({
      publication: { remote_container_id: '300', error_code: 'publish-intent' },
      graph: (call) => {
        if (call.url.pathname.endsWith('/300')) return Response.json({ id: '300', status_code: 'PUBLISHED' });
        if (call.url.pathname.endsWith('/17841400000000001/media') && call.method === 'GET') return Response.json({ data: [{ id: '90001', caption, timestamp: '2026-10-23T15:01:00+0000', permalink: 'https://www.instagram.com/reel/offline-qa/', media_type: 'REELS' }] });
        return undefined;
      },
    });
    expect(await publishMarketingRevision(input)).toMatchObject({ status: 'published', remoteMediaId: '90001', remoteUrl: 'https://www.instagram.com/reel/offline-qa/' });
    expect(posts()).toEqual([]);
  });
});
