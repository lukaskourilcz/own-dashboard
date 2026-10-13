import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { parseSourcePacket, revisionReadiness, type ContentRevision } from '@/lib/marketing/contracts';
import { contentHash, revisionHash } from '@/lib/marketing/hashes';
import { publicationGate, publishMarketingRevision, reconcileMarketingPublication, type PublishMarketingInput, type PublisherCheckpoint } from '@/lib/marketing/publisher';
vi.mock('server-only', () => ({}));
const now = new Date('2026-10-13T12:00:00Z');
const owner = '11111111-1111-4111-8111-111111111111';
let jpeg: Buffer; let wrongDimensions: Buffer; let png: Buffer; let oriented: Buffer;
beforeAll(async () => {
  const image = (height: number) => sharp({ create: { width: 1080, height, channels: 3, background: '#132019' } });
  jpeg = await image(1920).jpeg().toBuffer();
  wrongDimensions = await image(1350).jpeg().toBuffer();
  png = await image(1920).png().toBuffer();
  oriented = await image(1920).jpeg().withMetadata({ orientation: 6 }).toBuffer();
});
function fixture(assetBytes = jpeg, accountType: unknown = 'BUSINESS') {
  const content = { title: 'OFFLINE QA Story', body: 'Synthetic QA source, no live proof.', category: 'javascript', difficulty: '1', code: null, options: ['A', 'B'], answer: 'A', explanation: 'Synthetic QA explanation.', evidence: [], image: null };
  const source = parseSourcePacket({ schemaVersion: 'marketing-source/1', brand: 'devshark', kind: 'question', sourceId: 'question:offline-story-qa', sourceRevision: 'offline-qa/1', contentHash: contentHash(content), canonicalUrl: 'https://devshark.app/quiz?categories=javascript', locale: 'en', observedAt: now.toISOString(), expiresAt: null, eligible: true, eligibilityReason: 'OFFLINE QA only', content });
  const revision: ContentRevision = { schemaVersion: 'marketing-content/1', brand: 'devshark', title: content.title, caption: 'Internal review note; not a public Story caption.', format: 'story', sources: [{ sourceId: source.sourceId, sourceRevision: source.sourceRevision, contentHash: source.contentHash }], knowledgeIds: [], assets: [{ url: 'https://assets.example.invalid/story.jpg', sha256: createHash('sha256').update(assetBytes).digest('hex'), mimeType: 'image/jpeg', width: 1080, height: 1920, alt: 'Internal QA Story description' }], account: { id: '101', platform: 'instagram', handle: 'qa_only' }, scheduledAt: now.toISOString(), timeZone: 'Europe/Prague', templateVersion: 'offline-qa-story/1', promptVersion: 'offline-authored/1', model: 'none-offline-qa', traceId: null };
  const hash = revisionHash(revision); const requests: { url: URL; method: string; body: URLSearchParams }[] = []; const checkpoints: PublisherCheckpoint[] = [];
  const types: unknown[] = [accountType, accountType]; let profileReads = 0;
  const input: PublishMarketingInput = { now, dryRun: false, revisionRow: { id: '22222222-2222-4222-8222-222222222222', user_id: owner, project_id: null, campaign_id: null, revision, content_hash: hash, approved_hash: hash, status: 'approved', ready: true, approved_at: now.toISOString(), feedback: null, created_at: now.toISOString() }, publication: { id: '33333333-3333-4333-8333-333333333333', user_id: owner, revision_id: '22222222-2222-4222-8222-222222222222', platform: 'instagram', status: 'claimed', lease_until: '2026-10-13T12:10:00Z', remote_container_id: null, remote_media_id: null, remote_url: null, error_code: null }, account: { id: '44444444-4444-4444-8444-444444444444', user_id: owner, brand: 'devshark', platform: 'instagram', remote_account_id: '101', handle: 'qa_only', verified_at: now.toISOString(), enabled: true }, sources: [source], config: { enabled: true, apiVersion: 'v99.0', apiVersionVerifiedAt: now.toISOString(), loginMode: 'instagram', accessToken: 'OFFLINE-QA-NO-CREDENTIAL', tokenExpiresAt: '2026-10-14T12:00:00Z', scopes: ['instagram_business_basic', 'instagram_business_content_publish'], approvedAssetHosts: ['assets.example.invalid'], pollIntervalMs: 0 }, checkpoint: async value => { checkpoints.push(value); }, revalidate: async () => input, fetcher: async (value, options) => {
    const url = new URL(String(value)); const method = options?.method ?? 'GET'; const body = new URLSearchParams(String(options?.body ?? '')); requests.push({ url, method, body });
    if (url.hostname === 'assets.example.invalid') return new Response(new Uint8Array(assetBytes), { headers: { 'Content-Type': 'image/jpeg' } });
    if (url.pathname.endsWith('/101')) { profileReads++; return Response.json({ id: '101', username: 'qa_only', account_type: types[Math.min(profileReads - 1, 1)] }); }
    if (url.pathname.endsWith('/content_publishing_limit')) return Response.json({ data: [{ quota_usage: 0, config: { quota_total: 100 } }] });
    if (url.pathname.endsWith('/media') && method === 'POST') { expect(checkpoints[0]).toMatchObject({ stage: 'container-create-intent' }); return Response.json({ id: '201' }); }
    if (url.pathname.endsWith('/201')) return Response.json({ id: '201', status_code: 'FINISHED' });
    if (url.pathname.endsWith('/media_publish') && method === 'POST') { expect(checkpoints.at(-1)).toMatchObject({ stage: 'publish-intent', remoteContainerId: '201' }); return Response.json({ id: '301' }); }
    if (url.pathname.endsWith('/301')) return Response.json({ id: '301', permalink: 'https://www.instagram.com/stories/qa_only/301/' });
    throw new Error('Unexpected offline QA request');
  } };
  const reapprove = () => { const h = revisionHash(input.revisionRow.revision); input.revisionRow.content_hash = h; input.revisionRow.approved_hash = h; };
  return { input, requests, checkpoints, types, reapprove };
}

describe('bounded Instagram single-JPEG Story capability, offline only', () => {
  it('readiness holds unsupported platforms, missing/multiple/non-JPEG/landscape assets', () => {
    const { input } = fixture(); const revision = input.revisionRow.revision;
    expect(revisionReadiness(revision)).toEqual([]);
    expect(revisionReadiness({ ...revision, account: { ...revision.account, platform: 'threads' } })).toContain('story-instagram-required');
    expect(revisionReadiness({ ...revision, assets: [] })).toContain('story-single-jpeg-required');
    expect(revisionReadiness({ ...revision, assets: [...revision.assets, ...revision.assets] })).toContain('story-single-jpeg-required');
    expect(revisionReadiness({ ...revision, assets: [{ ...revision.assets[0], mimeType: 'video/mp4' }] })).toContain('story-single-jpeg-required');
    expect(revisionReadiness({ ...revision, assets: [{ ...revision.assets[0], height: 1350 }] })).toContain('story-image-dimensions-required');
  });
  it('publishes one exact JPEG as STORIES, without feed fields or carousel conversion', async () => {
    const { input, requests, checkpoints } = fixture();
    expect(publicationGate(input, input.config, now)).toBeNull();
    expect(await publishMarketingRevision(input)).toMatchObject({ status: 'published', remoteContainerId: '201', remoteMediaId: '301' });
    const posts = requests.filter(v => v.method === 'POST'); expect(posts).toHaveLength(2);
    expect(Object.fromEntries(posts[0].body)).toEqual({ media_type: 'STORIES', image_url: input.revisionRow.revision.assets[0].url });
    expect(Object.fromEntries(posts[1].body)).toEqual({ creation_id: '201' });
    const profiles = requests.filter(v => v.url.pathname.endsWith('/101'));
    expect(profiles).toHaveLength(2); expect(profiles.every(v => v.url.searchParams.get('fields') === 'id,username,account_type')).toBe(true);
    expect(checkpoints.map(v => v.stage)).toEqual(['container-create-intent', 'container-created', 'publish-intent', 'outcome']);
    expect(checkpoints.at(-1)).toMatchObject({ status: 'published', remoteMediaId: '301', remoteUrl: null, errorCode: null });
    expect(posts[0].body.has('caption')).toBe(false); expect(posts[0].body.has('alt_text')).toBe(false); expect(posts[0].body.has('children')).toBe(false);
  });
  it.each([undefined, null, 'MEDIA_CREATOR', 'PERSONAL', 'unknown'])('holds missing or unsupported account_type %s before any POST', async accountType => {
    const { input, requests, checkpoints } = fixture(jpeg, accountType); // undefined needs explicit replacement of the fixture default.
    const original = input.fetcher!; input.fetcher = async (value, options) => new URL(String(value)).pathname.endsWith('/101') ? Response.json({ id: '101', username: 'qa_only', account_type: accountType }) : original(value, options);
    expect(await publishMarketingRevision(input)).toMatchObject({ status: 'held', errorCode: 'story-business-account-unverified' });
    expect(requests.some(v => v.method === 'POST')).toBe(false); expect(checkpoints).toEqual([]);
  });
  it('holds a missing live Business capability proof when the profile lookup fails', async () => {
    const { input, requests } = fixture(); input.fetcher = async () => new Response(null, { status: 400 });
    expect(await publishMarketingRevision(input)).toMatchObject({ status: 'held', errorCode: 'story-business-account-unverified' }); expect(requests).toEqual([]);
  });
  it.each(['dimensions', 'format', 'orientation'] as const)('rejects wrong actual JPEG %s despite correct approved metadata/hash', async kind => {
    const bytes = kind === 'dimensions' ? wrongDimensions : kind === 'format' ? png : oriented;
    const { input, requests } = fixture(bytes);
    const outcome = await publishMarketingRevision(input);
    expect(outcome.errorCode).toBe(kind === 'format' ? 'story-image-format-invalid' : 'story-image-dimensions-invalid');
    expect(requests.some(v => v.method === 'POST')).toBe(false);
  });
  it('decodes a genuine complete JPEG instead of trusting an intact header on truncated bytes', async () => {
    const { input, requests } = fixture(jpeg.subarray(0, jpeg.length - 200));
    expect(await publishMarketingRevision(input)).toMatchObject({ status: 'failed', errorCode: 'story-image-invalid' });
    expect(requests.some(v => v.method === 'POST')).toBe(false);
  });
  it('holds exact-approval, freshness, host, and byte mutations before any Story POST', async () => {
    for (const mutation of ['approval', 'source', 'host', 'bytes']) {
      const { input, requests } = fixture();
      if (mutation === 'approval') input.revisionRow.approved_hash = 'f'.repeat(64);
      if (mutation === 'source') input.sources[0].observedAt = '2026-10-13T11:44:59Z';
      if (mutation === 'host') { input.revisionRow.revision.assets[0].url = 'https://unapproved.example.invalid/story.jpg'; const hash = revisionHash(input.revisionRow.revision); input.revisionRow.content_hash = hash; input.revisionRow.approved_hash = hash; }
      if (mutation === 'bytes') { const original = input.fetcher!; input.fetcher = async (value, options) => new URL(String(value)).hostname === 'assets.example.invalid' ? new Response(new Uint8Array(wrongDimensions), { headers: { 'Content-Type': 'image/jpeg' } }) : original(value, options); }
      const outcome = await publishMarketingRevision(input); expect(['held', 'failed']).toContain(outcome.status); expect(requests.some(v => v.method === 'POST')).toBe(false);
    }
  });
  it('rechecks Business capability and exact approval immediately before final publish intent', async () => {
    const changed = fixture(); changed.types[1] = 'MEDIA_CREATOR';
    expect(await publishMarketingRevision(changed.input)).toMatchObject({ status: 'held', errorCode: 'story-business-account-unverified', remoteContainerId: '201' });
    expect(changed.requests.filter(v => v.method === 'POST')).toHaveLength(1); expect(changed.checkpoints.some(v => v.stage === 'publish-intent')).toBe(false);
    const revoked = fixture(); revoked.input.revalidate = async () => ({ ...revoked.input, revisionRow: { ...revoked.input.revisionRow, approved_hash: null, status: 'returned' } });
    expect(await publishMarketingRevision(revoked.input)).toMatchObject({ status: 'held', errorCode: 'exact-approval-required' }); expect(revoked.requests.filter(v => v.method === 'POST')).toHaveLength(1);
    const mutated = fixture(); mutated.input.revalidate = async () => { mutated.input.revisionRow.revision.assets[0].alt = 'Changed review descriptor'; return mutated.input; };
    expect(await publishMarketingRevision(mutated.input)).toMatchObject({ status: 'held', errorCode: 'exact-approval-required' }); expect(mutated.requests.filter(v => v.method === 'POST')).toHaveLength(1);
    const replacement = fixture(); replacement.input.revalidate = async () => {
      const revision = { ...replacement.input.revisionRow.revision, caption: 'A newly approved internal review note' }; const hash = revisionHash(revision);
      return { ...replacement.input, revisionRow: { ...replacement.input.revisionRow, revision, content_hash: hash, approved_hash: hash } };
    };
    expect(await publishMarketingRevision(replacement.input)).toMatchObject({ status: 'held', errorCode: 'approval-changed-before-publish' });
    expect(replacement.requests.filter(v => v.method === 'POST')).toHaveLength(1);
  });
  it('requires a durable intent fence before any Story container creation', async () => {
    const { input, requests } = fixture(); input.checkpoint = async () => { throw new Error('Offline QA fence lost'); };
    expect(await publishMarketingRevision(input)).toMatchObject({ status: 'held', errorCode: 'checkpoint-fence-lost', remoteContainerId: null });
    expect(requests.some(v => v.method === 'POST')).toBe(false);
  });
  it('records a numeric Story publish acknowledgement without requiring a permanent URL', async () => {
    const { input, requests } = fixture(); const original = input.fetcher!;
    input.fetcher = async (value, options) => new URL(String(value)).pathname.endsWith('/301') ? Response.json({ id: '301' }) : original(value, options);
    expect(await publishMarketingRevision(input)).toMatchObject({ status: 'published', remoteMediaId: '301', remoteUrl: null });
    const before = requests.filter(v => v.method === 'POST').length;
    expect(await publishMarketingRevision({ ...input, config: { ...input.config, accessToken: '', tokenExpiresAt: '' }, publication: { ...input.publication, status: 'published', remote_container_id: '201', remote_media_id: '301', error_code: null } })).toMatchObject({ status: 'published', remoteMediaId: '301', remoteUrl: null });
    expect(requests.filter(v => v.method === 'POST')).toHaveLength(before);
  });
  it('requires owned remote Story evidence when a recorded media ID has no stored acknowledgement', async () => {
    const { input, requests } = fixture(); const original = input.fetcher!;
    input.publication = { ...input.publication, status: 'reconciliation', remote_container_id: '201', remote_media_id: '301', error_code: 'remote-permalink-unavailable' };
    input.fetcher = async (value, options) => { const url = new URL(String(value)); if (url.pathname.endsWith('/101/stories')) { requests.push({ url, method: options?.method ?? 'GET', body: new URLSearchParams() }); return Response.json({ data: [{ id: '301' }] }); } return original(value, options); };
    expect(await reconcileMarketingPublication(input)).toMatchObject({ status: 'published', remoteMediaId: '301', remoteUrl: null });
    expect(requests.some(v => v.url.pathname.endsWith('/101/stories'))).toBe(true); expect(requests.every(v => v.method === 'GET')).toBe(true);
    input.fetcher = async (value, options) => new URL(String(value)).pathname.endsWith('/101/stories') ? Response.json({ data: [{ id: '999' }] }) : original(value, options);
    expect(await reconcileMarketingPublication(input)).toMatchObject({ status: 'reconciliation', errorCode: 'remote-story-unverified' });
  });
  it('bounds Story pagination, ignores provider next URLs, and never guesses a missing media ID', async () => {
    const { input, requests } = fixture(); const original = input.fetcher!; let pages = 0;
    input.publication = { ...input.publication, status: 'reconciliation', remote_container_id: '201', remote_media_id: '301' };
    input.fetcher = async (value, options) => { const url = new URL(String(value)); if (url.pathname.endsWith('/101/stories')) { pages++; expect(url.hostname).toBe('graph.instagram.com'); return Response.json({ data: [{ id: '999' }], paging: { next: 'https://untrusted.example.invalid/DO-NOT-FETCH', cursors: { after: `cursor-${pages}` } } }); } return original(value, options); };
    expect(await reconcileMarketingPublication(input)).toMatchObject({ status: 'reconciliation', errorCode: 'remote-story-unverified' }); expect(pages).toBe(2);
    input.publication.remote_media_id = null;
    input.fetcher = async (value, options) => new URL(String(value)).pathname.endsWith('/201') ? Response.json({ id: '201', status_code: 'PUBLISHED' }) : original(value, options);
    expect(await reconcileMarketingPublication(input)).toMatchObject({ status: 'reconciliation', errorCode: 'remote-published-media-id-required', remoteMediaId: null });
    expect(requests.every(v => v.method === 'GET')).toBe(true);
  });
  it.each(['0', 'not-a-media-id', '001'])('keeps an invalid publish acknowledgement %s ambiguous', async id => {
    const { input } = fixture(); const original = input.fetcher!;
    input.fetcher = async (value, options) => new URL(String(value)).pathname.endsWith('/media_publish') ? Response.json({ id }) : original(value, options);
    expect(await publishMarketingRevision(input)).toMatchObject({ status: 'reconciliation', errorCode: 'published-media-identity-unavailable', remoteMediaId: null });
  });
});
