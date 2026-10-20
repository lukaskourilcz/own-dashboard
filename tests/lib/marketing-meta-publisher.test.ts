import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { parseSourcePacket, type ContentRevision } from '@/lib/marketing/contracts';
import { contentHash, revisionHash } from '@/lib/marketing/hashes';
import { instagramFeedGeometryValid, publicationGate, publishMarketingRevision, reconcileMarketingPublication, type PublishMarketingInput, type PublisherCheckpoint } from '@/lib/marketing/publisher';
vi.mock('server-only', () => ({}));

// Offline mock of the Instagram Graph API. No request leaves the process and
// every token, ID and caption below is a synthetic fixture.
const now = new Date('2026-10-20T07:00:00Z');
const owner = '11111111-1111-4111-8111-111111111111';
const token = 'TEST-ONLY-INSTAGRAM-LOGIN-TOKEN';
const caption = 'DNESKAi offline QA: tři věci, které se dnes v AI změnily. Zdroj v posledním slidu.';
type Asset = { bytes: Buffer; width: number; height: number; mime?: 'image/jpeg' | 'video/mp4' };
type Call = { url: URL; method: string; body: URLSearchParams };
let portrait: Buffer; let square: Buffer; let tall: Buffer; let wide: Buffer; let png: Buffer;
beforeAll(async () => {
  const image = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: '#2f5ae6' } });
  portrait = await image(1080, 1350).jpeg().toBuffer();
  square = await image(1080, 1080).jpeg().toBuffer();
  tall = await image(1080, 1920).jpeg().toBuffer();
  wide = await image(1600, 1000).jpeg().toBuffer();
  png = await image(1080, 1350).png().toBuffer();
});
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');

function fixture(options: { format?: 'carousel' | 'post'; assets?: Asset[]; collaborators?: string[]; graph?: (call: Call) => Response | undefined } = {}) {
  const format = options.format ?? 'carousel';
  const assets = options.assets ?? (format === 'carousel' ? [{ bytes: portrait, width: 1080, height: 1350 }, { bytes: portrait, width: 1080, height: 1350 }, { bytes: square, width: 1080, height: 1080 }] : [{ bytes: portrait, width: 1080, height: 1350 }]);
  const content = { title: 'OFFLINE QA článek', body: 'Syntetický zdroj pouze pro test.', category: 'ai-news', difficulty: null, code: null, options: [], answer: null, explanation: null,
    evidence: [{ url: 'https://example.invalid/source', title: 'QA zdroj', excerpt: 'QA', checkedAt: now.toISOString() }], image: null };
  const source = parseSourcePacket({ schemaVersion: 'marketing-source/1', brand: 'dneskai', kind: 'article', sourceId: 'article:offline-qa', sourceRevision: 'qa/1', contentHash: contentHash(content),
    canonicalUrl: 'https://dneskai.vercel.app/articles/offline-qa', locale: 'cs', observedAt: now.toISOString(), expiresAt: null, eligible: true, eligibilityReason: 'OFFLINE QA only', content });
  const revision: ContentRevision = { schemaVersion: 'marketing-content/1', brand: 'dneskai', title: 'OFFLINE QA carousel', caption, format,
    sources: [{ sourceId: source.sourceId, sourceRevision: source.sourceRevision, contentHash: source.contentHash }], knowledgeIds: [],
    assets: assets.map((asset, index) => ({ url: `https://assets.example.invalid/slide-${index + 1}.jpg`, sha256: sha(asset.bytes), mimeType: asset.mime ?? 'image/jpeg', width: asset.width, height: asset.height, alt: `Slide ${index + 1}: popis obrázku pro čtečku.` })),
    account: { id: '17841400000000001', platform: 'instagram', handle: 'dneskai' }, ...(options.collaborators ? { collaborators: options.collaborators } : {}),
    scheduledAt: now.toISOString(), timeZone: 'Europe/Prague', templateVersion: 'qa/1', promptVersion: 'qa/1', model: 'none-offline', traceId: null };
  const hash = revisionHash(revision);
  const calls: Call[] = []; const checkpoints: PublisherCheckpoint[] = []; let nextChild = 200;
  const input: PublishMarketingInput = { now, dryRun: false,
    revisionRow: { id: '22222222-2222-4222-8222-222222222222', user_id: owner, project_id: null, campaign_id: null, revision, content_hash: hash, status: 'approved', ready: true, approved_at: now.toISOString(), approved_hash: hash, feedback: null, created_at: now.toISOString() },
    publication: { id: '33333333-3333-4333-8333-333333333333', user_id: owner, revision_id: '22222222-2222-4222-8222-222222222222', platform: 'instagram', status: 'claimed', lease_until: '2026-10-20T07:10:00Z', remote_container_id: null, remote_media_id: null, remote_url: null, error_code: null },
    account: { id: '44444444-4444-4444-8444-444444444444', user_id: owner, brand: 'dneskai', platform: 'instagram', remote_account_id: '17841400000000001', handle: 'dneskai', verified_at: '2026-10-20T06:00:00Z', enabled: true },
    sources: [source],
    config: { enabled: true, apiVersion: 'v99.0', apiVersionVerifiedAt: '2026-10-20T06:00:00Z', loginMode: 'instagram', accessToken: token, tokenExpiresAt: '2026-12-01T00:00:00Z',
      scopes: ['instagram_business_basic', 'instagram_business_content_publish'], approvedAssetHosts: ['assets.example.invalid'], pollIntervalMs: 0, credentialSource: 'database' },
    checkpoint: async value => { checkpoints.push(value); }, revalidate: async () => input,
    fetcher: async (value, init) => {
      const url = new URL(String(value)); const method = init?.method ?? 'GET'; const body = new URLSearchParams(String(init?.body ?? '')); const call = { url, method, body }; calls.push(call);
      if (url.hostname === 'assets.example.invalid') {
        const asset = assets[Number(url.pathname.match(/slide-(\d+)/)![1]) - 1]!;
        return new Response(new Uint8Array(asset.bytes), { headers: { 'Content-Type': asset.mime ?? 'image/jpeg' } });
      }
      expect(url.hostname).toBe('graph.instagram.com');
      expect(url.href).not.toContain(token);
      const custom = options.graph?.(call); if (custom) return custom;
      if (url.pathname.endsWith('/17841400000000001') && method === 'GET') return Response.json({ id: '1234567', user_id: '17841400000000001', username: 'dneskai' });
      if (url.pathname.endsWith('/content_publishing_limit')) return Response.json({ data: [{ quota_usage: 3, config: { quota_total: 50, quota_duration: 86400 } }] });
      if (url.pathname.endsWith('/media_publish') && method === 'POST') { expect(checkpoints.at(-1)).toMatchObject({ stage: 'publish-intent' }); return Response.json({ id: '90001' }); }
      if (url.pathname.endsWith('/media') && method === 'POST') { expect(checkpoints[0]).toMatchObject({ stage: 'container-create-intent' }); return Response.json({ id: body.get('is_carousel_item') ? String(++nextChild) : '300' }); }
      if (url.pathname.endsWith('/300')) return Response.json({ id: '300', status_code: 'FINISHED' });
      if (url.pathname.endsWith('/90001')) return Response.json({ id: '90001', permalink: 'https://www.instagram.com/p/offline-qa/' });
      throw new Error(`unexpected offline request ${method} ${url.pathname}`);
    } };
  const reapprove = () => { const h = revisionHash(input.revisionRow.revision); input.revisionRow.content_hash = h; input.revisionRow.approved_hash = h; };
  return { input, calls, checkpoints, reapprove, posts: () => calls.filter(call => call.method === 'POST') };
}

describe('DNESKAi Instagram publisher against a mocked Graph API', () => {
  it('publishes a carousel with alt text per child, a parent without children alt and exactly one media_publish', async () => {
    const { input, posts, checkpoints, calls } = fixture();
    expect(await publishMarketingRevision(input)).toEqual({ status: 'published', remoteContainerId: '300', remoteMediaId: '90001', remoteUrl: 'https://www.instagram.com/p/offline-qa/', errorCode: null });
    const sent = posts();
    expect(sent).toHaveLength(5);
    const children = sent.slice(0, 3).map(call => Object.fromEntries(call.body));
    expect(children).toEqual(input.revisionRow.revision.assets.map(asset => ({ image_url: asset.url, is_carousel_item: 'true', alt_text: asset.alt })));
    expect(Object.fromEntries(sent[3]!.body)).toEqual({ caption, media_type: 'CAROUSEL', children: '201,202,203' });
    expect(Object.fromEntries(sent[4]!.body)).toEqual({ creation_id: '300' });
    expect(sent.filter(call => call.url.pathname.endsWith('/media_publish'))).toHaveLength(1);
    expect(checkpoints.map(value => value.stage)).toEqual(['container-create-intent', 'container-created', 'publish-intent', 'outcome', 'outcome']);
    // The account check uses the Instagram Login professional ID, and the quota is read before any container.
    expect(calls.find(call => call.url.pathname.endsWith('/17841400000000001'))!.url.searchParams.get('fields')).toBe('id,user_id,username');
    expect(calls.findIndex(call => call.url.pathname.endsWith('/content_publishing_limit'))).toBeLessThan(calls.findIndex(call => call.method === 'POST'));
    expect(JSON.stringify(checkpoints)).not.toContain(token);
  });
  it('sends collaborators on the carousel parent only when the revision carries them', async () => {
    const { input, posts } = fixture({ collaborators: ['partner.lab', 'second_author'] });
    expect((await publishMarketingRevision(input)).status).toBe('published');
    const sent = posts();
    expect(sent.slice(0, 3).every(call => !call.body.has('collaborators'))).toBe(true);
    expect(JSON.parse(sent[3]!.body.get('collaborators')!)).toEqual(['partner.lab', 'second_author']);
    // More than three never parses as a revision; duplicates and the account itself are refused by the gate.
    for (const [collaborators, code] of [[['a', 'b', 'c', 'd'], 'invalid-revision'], [['same', 'SAME'], 'collaborators-invalid'], [['dneskai'], 'collaborators-invalid']] as const) {
      const held = fixture({ collaborators: [...collaborators] }); held.reapprove();
      expect(publicationGate(held.input, held.input.config, now)).toBe(code);
    }
  });
  it('publishes a single image as the default image container without media_type or children', async () => {
    const { input, posts } = fixture({ format: 'post', graph: ({ url, method }) => url.pathname.endsWith('/media') && method === 'POST' ? Response.json({ id: '300' }) : undefined });
    expect(await publishMarketingRevision(input)).toMatchObject({ status: 'published', remoteMediaId: '90001' });
    const sent = posts();
    expect(sent).toHaveLength(2);
    expect(Object.fromEntries(sent[0]!.body)).toEqual({ caption, image_url: input.revisionRow.revision.assets[0]!.url, alt_text: input.revisionRow.revision.assets[0]!.alt });
  });
  it('keeps an IN_PROGRESS container pending and never publishes it', async () => {
    const { input, posts, checkpoints } = fixture({ graph: ({ url }) => url.pathname.endsWith('/300') ? Response.json({ id: '300', status_code: 'IN_PROGRESS' }) : undefined });
    expect(await publishMarketingRevision(input)).toMatchObject({ status: 'pending', errorCode: 'container-pending', remoteContainerId: '300' });
    expect(posts().some(call => call.url.pathname.endsWith('/media_publish'))).toBe(false);
    expect(checkpoints.map(value => value.stage)).toEqual(['container-create-intent', 'container-created']);
  });
  it.each(['ERROR', 'EXPIRED'])('records a %s container as a definite failure without media_publish', async status => {
    const { input, posts, checkpoints } = fixture({ graph: ({ url }) => url.pathname.endsWith('/300') ? Response.json({ id: '300', status_code: status }) : undefined });
    const outcome = await publishMarketingRevision(input);
    expect(outcome).toEqual({ status: 'failed', errorCode: `container-${status.toLowerCase()}`, remoteContainerId: '300', remoteMediaId: null, remoteUrl: null });
    expect(checkpoints.at(-1)).toMatchObject({ stage: 'outcome', status: 'failed' });
    expect(posts().some(call => call.url.pathname.endsWith('/media_publish'))).toBe(false);
  });
  it('holds an exhausted or unreported publishing limit before any container', async () => {
    for (const [limit, code] of [[{ data: [{ quota_usage: 50, config: { quota_total: 50 } }] }, 'publishing-quota-exhausted'], [{ data: [{ quota_usage: 0, config: {} }] }, 'publishing-quota-unavailable'], [{ data: [] }, 'publishing-quota-unavailable']] as const) {
      const { input, posts, checkpoints } = fixture({ graph: ({ url }) => url.pathname.endsWith('/content_publishing_limit') ? Response.json(limit) : undefined });
      expect(await publishMarketingRevision(input)).toMatchObject({ status: 'held', errorCode: code });
      expect(posts()).toHaveLength(0); expect(checkpoints).toHaveLength(0);
    }
  });
  it('holds an expired, missing or store-held token before any Graph request', async () => {
    for (const [patch, code] of [[{ tokenExpiresAt: '2026-10-20T06:59:59Z' }, 'access-token-expired'], [{ accessToken: '' }, 'access-token-missing'], [{ tokenExpiresAt: 'soon' }, 'access-token-expiry-unverified'], [{ accessToken: '', credentialHold: 'credential-store-unavailable' }, 'credential-store-unavailable']] as const) {
      const { input, calls } = fixture(); input.config = { ...input.config, ...patch };
      expect(await publishMarketingRevision(input)).toMatchObject({ status: 'held', errorCode: code });
      expect(calls).toHaveLength(0);
    }
  });
  it('checks geometry, format, size and declared dimensions of every image before creating containers', () => {
    expect([[1080, 1350], [1080, 1080], [1440, 754], [320, 400]].every(([w, h]) => instagramFeedGeometryValid(w!, h!))).toBe(true);
    expect([[1080, 1351], [1080, 1920], [1600, 1000], [319, 300], [1440, 753]].some(([w, h]) => instagramFeedGeometryValid(w!, h!))).toBe(false);
    const declared = fixture({ assets: [{ bytes: portrait, width: 1080, height: 1350 }, { bytes: tall, width: 1080, height: 1920 }] });
    expect(publicationGate(declared.input, declared.input.config, now)).toBe('asset-geometry-unsupported');
  });
  it.each([
    ['a PNG served as JPEG', { bytes: Buffer.alloc(0), width: 1080, height: 1350 }, 'asset-format-unsupported'],
    ['a 1600 px wide image declared as portrait', { bytes: Buffer.alloc(0), width: 1080, height: 1350 }, 'asset-dimensions-unsupported'],
    ['a square image declared as portrait', { bytes: Buffer.alloc(0), width: 1080, height: 1350 }, 'asset-dimensions-mismatch'],
  ] as const)('refuses %s from the downloaded bytes', async (_label, base, code) => {
    const bytes = code === 'asset-format-unsupported' ? png : code === 'asset-dimensions-unsupported' ? wide : square;
    const { input, posts } = fixture({ assets: [{ bytes: portrait, width: 1080, height: 1350 }, { ...base, bytes }] });
    expect(await publishMarketingRevision(input)).toMatchObject({ status: 'failed', errorCode: code });
    expect(posts()).toHaveLength(0);
  });
  it('refuses an image over 8 MiB before decoding it', async () => {
    const big = Buffer.concat([portrait, Buffer.alloc(8 * 1024 * 1024)]);
    const { input, posts } = fixture({ format: 'post', assets: [{ bytes: big, width: 1080, height: 1350 }] });
    expect(await publishMarketingRevision(input)).toMatchObject({ status: 'failed', errorCode: 'asset-too-large' });
    expect(posts()).toHaveLength(0);
  });
  it('limits hashtags and mentions in an Instagram caption', () => {
    const tags = fixture(); tags.input.revisionRow.revision.caption = `${caption} ${Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(' ')}`; tags.reapprove();
    expect(publicationGate(tags.input, tags.input.config, now)).toBe('caption-hashtag-limit');
    const mentions = fixture(); mentions.input.revisionRow.revision.caption = `${caption} ${Array.from({ length: 21 }, (_, i) => `@user${i}`).join(' ')} redakce@dneskai.cz`; mentions.reapprove();
    expect(publicationGate(mentions.input, mentions.input.config, now)).toBe('caption-mention-limit');
  });
});

describe('reconciliation after an ambiguous media_publish', () => {
  // `publishFirst` runs the real publish up to the timed-out media_publish; otherwise the record already says reconciliation.
  const ambiguous = (list: (call: Call) => Response, status = 'PUBLISHED', publishFirst = false) => {
    let publishTimedOut = !publishFirst;
    const state = fixture({ graph: call => {
      if (call.url.pathname.endsWith('/media_publish')) { publishTimedOut = true; throw new DOMException('offline timeout', 'TimeoutError'); }
      if (call.url.pathname.endsWith('/300') && publishTimedOut) return Response.json({ id: '300', status_code: status });
      if (call.url.pathname.endsWith('/17841400000000001/media') && call.method === 'GET') return list(call);
      return undefined;
    } });
    return state;
  };
  const item = (patch: Record<string, unknown> = {}) => ({ id: '90001', caption: `${caption}\n\n#ai #dneskai`, timestamp: '2026-10-20T07:00:41+0000', permalink: 'https://www.instagram.com/p/offline-qa/', media_type: 'CAROUSEL_ALBUM', ...patch });
  it('moves a timed-out publish to reconciliation, then records the unique media-list match without a second POST', async () => {
    const state = ambiguous(() => Response.json({ data: [item({ id: '80000', caption: 'Jiný příspěvek', timestamp: '2026-10-20T06:58:00+0000' }), item()] }), 'PUBLISHED', true);
    const first = await publishMarketingRevision(state.input);
    expect(first).toMatchObject({ status: 'reconciliation', errorCode: 'meta-request-uncertain', remoteContainerId: '300', remoteMediaId: null });
    const postCount = state.posts().length;
    const recovered = await reconcileMarketingPublication({ ...state.input, publication: { ...state.input.publication, status: 'reconciliation', remote_container_id: '300', error_code: first.errorCode } });
    expect(recovered).toEqual({ status: 'published', remoteContainerId: '300', remoteMediaId: '90001', remoteUrl: 'https://www.instagram.com/p/offline-qa/', errorCode: null });
    expect(state.posts()).toHaveLength(postCount);
    const list = state.calls.find(call => call.url.pathname.endsWith('/media') && call.method === 'GET')!;
    expect(list.url.searchParams.get('fields')).toBe('id,caption,timestamp,permalink,media_type');
    expect(list.url.searchParams.get('since')).toBe(String(Date.parse('2026-10-20T06:55:00Z') / 1000));
    // Re-entering the publisher with a reconciliation record also only reads.
    expect((await publishMarketingRevision({ ...state.input, publication: { ...state.input.publication, status: 'reconciliation', remote_container_id: '300', error_code: first.errorCode } })).status).toBe('published');
    expect(state.posts()).toHaveLength(postCount);
  });
  it.each([
    ['two matching posts', [item(), item({ id: '90002' })], 'PUBLISHED', 'remote-media-match-ambiguous'],
    ['a post of another media type', [item({ media_type: 'IMAGE' })], 'PUBLISHED', 'remote-published-media-id-required'],
    ['a post outside the slot window', [item({ timestamp: '2026-10-20T06:54:00+0000' })], 'PUBLISHED', 'remote-published-media-id-required'],
    ['a different caption', [item({ caption: 'DNESKAi: jiný text' })], 'PUBLISHED', 'remote-published-media-id-required'],
    ['a container Meta still reports as FINISHED', [item()], 'FINISHED', 'remote-container-finished'],
  ] as const)('stays in reconciliation for %s', async (_label, data, status, code) => {
    const state = ambiguous(() => Response.json({ data }), status);
    const recovered = await reconcileMarketingPublication({ ...state.input, publication: { ...state.input.publication, status: 'reconciliation', remote_container_id: '300', error_code: 'meta-request-uncertain' } });
    expect(recovered).toMatchObject({ status: 'reconciliation', errorCode: code, remoteMediaId: null });
    expect(state.posts()).toHaveLength(0);
  });
  it('reads the permalink separately when the list omits it and never guesses one', async () => {
    const state = ambiguous(() => Response.json({ data: [item({ permalink: undefined })] }));
    const recovered = await reconcileMarketingPublication({ ...state.input, publication: { ...state.input.publication, status: 'reconciliation', remote_container_id: '300', error_code: 'lease-expired' } });
    expect(recovered).toMatchObject({ status: 'published', remoteMediaId: '90001', remoteUrl: 'https://www.instagram.com/p/offline-qa/' });
  });
  it('holds reconciliation when only a held credential is available', async () => {
    const state = ambiguous(() => Response.json({ data: [item()] }));
    state.input.config = { ...state.input.config, accessToken: '', credentialHold: 'access-token-expired' };
    expect(await reconcileMarketingPublication({ ...state.input, publication: { ...state.input.publication, status: 'reconciliation', remote_container_id: '300' } })).toMatchObject({ status: 'held', errorCode: 'reconciliation-credentials-unavailable' });
    expect(state.calls).toHaveLength(0);
  });
});

describe('dry-run preflight', () => {
  it('runs only read-only checks and stops before the container-create intent', async () => {
    const { input, calls, checkpoints } = fixture();
    expect(await publishMarketingRevision({ ...input, dryRun: true })).toMatchObject({ status: 'dry-run', errorCode: null });
    expect(calls).toHaveLength(0);
    const preflight = await publishMarketingRevision({ ...input, dryRun: true, preflight: true, publication: { ...input.publication, status: 'queued', lease_until: null } });
    expect(preflight).toEqual({ status: 'dry-run', errorCode: null, remoteContainerId: null, remoteMediaId: null, remoteUrl: null });
    expect(calls.every(call => call.method === 'GET')).toBe(true);
    expect(calls.map(call => call.url.pathname.split('/').at(-1))).toEqual(['17841400000000001', 'slide-1.jpg', 'slide-2.jpg', 'slide-3.jpg', 'content_publishing_limit']);
    expect(checkpoints).toHaveLength(0);
  });
  it('reports a failing check as a hold without writing anything', async () => {
    const quota = fixture({ graph: ({ url }) => url.pathname.endsWith('/content_publishing_limit') ? Response.json({ data: [{ quota_usage: 50, config: { quota_total: 50 } }] }) : undefined });
    expect(await publishMarketingRevision({ ...quota.input, preflight: true, dryRun: undefined })).toMatchObject({ status: 'held', errorCode: 'publishing-quota-exhausted' });
    const image = fixture({ assets: [{ bytes: portrait, width: 1080, height: 1350 }, { bytes: png, width: 1080, height: 1350 }] });
    expect(await publishMarketingRevision({ ...image.input, preflight: true, dryRun: true })).toMatchObject({ status: 'held', errorCode: 'asset-format-unsupported' });
    const account = fixture({ graph: ({ url }) => url.pathname.endsWith('/17841400000000001') ? Response.json({ id: '1', user_id: '17841400000000999', username: 'dneskai' }) : undefined });
    expect(await publishMarketingRevision({ ...account.input, preflight: true, dryRun: true })).toMatchObject({ status: 'held', errorCode: 'remote-account-mismatch' });
    for (const state of [quota, image, account]) { expect(state.posts()).toHaveLength(0); expect(state.checkpoints).toHaveLength(0); }
  });
});
