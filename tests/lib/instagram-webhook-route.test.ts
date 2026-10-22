import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ after: [] as Array<() => Promise<void>>, handle: vi.fn(), admin: vi.fn(() => ({})) }));
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: (task: () => Promise<void>) => { mocks.after.push(task); } }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
vi.mock('@/lib/marketing/dneskai-engagement-ports', () => ({ createDneskaiEngagementStore: () => ({ kind: 'store' }), createDneskaiEngagementGraph: () => ({ kind: 'graph' }) }));
vi.mock('@/lib/marketing/dneskai-engagement-watch', async (actual) => ({ ...(await actual<typeof import('@/lib/marketing/dneskai-engagement-watch')>()), handleDneskaiCommentEvents: mocks.handle }));
import { GET, POST } from '@/app/api/webhooks/instagram/route';
import { handleDneskaiCommentEvents, type EngagementStore, type EngagementTarget } from '@/lib/marketing/dneskai-engagement-watch';
import { instagramCommentEvents } from '@/lib/marketing/dneskai-instagram-webhook';

/** #161: synthetic secrets and ids only. */
const VERIFY = 'verify-token-TEST-ONLY-0000', SECRET = 'app-secret-TEST-ONLY-00000000';
const OWNER = '11111111-1111-4111-8111-111111111111';
const url = 'https://own.example/api/webhooks/instagram';
const comment = (id: string, text = 'SKILL', media = '1790000000000001') => ({ id, text, media: { id: media, media_product_type: 'FEED' }, from: { id: '999', username: 'someone' } });
const body = (values: unknown[]) => JSON.stringify({ object: 'instagram', entry: [{ id: '17841400000000001', time: 1, field: 'comments', value: values[0] }, ...values.slice(1).map((value) => ({ id: '17841400000000001', time: 1, changes: [{ field: 'comments', value }] }))] });
const sign = (raw: string, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
const post = (raw: string, signature: string | null = sign(raw)) => new Request(url, { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json', ...(signature ? { 'X-Hub-Signature-256': signature } : {}) } });

beforeEach(() => {
  mocks.after.length = 0; vi.clearAllMocks();
  vi.stubEnv('DNESKAI_ENGAGEMENT_ENABLED', 'true'); vi.stubEnv('MARKETING_INSTAGRAM_WEBHOOK_VERIFY_TOKEN', VERIFY); vi.stubEnv('MARKETING_INSTAGRAM_APP_SECRET', SECRET); vi.stubEnv('MARKETING_OWNER_ID', OWNER);
  mocks.handle.mockResolvedValue({ sent: 1 });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('GET /api/webhooks/instagram (verification)', () => {
  it('answers the challenge only for the configured verify token', async () => {
    const ok = await GET(new Request(`${url}?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=1158201444`));
    expect(ok.status).toBe(200); expect(await ok.text()).toBe('1158201444');
    expect((await GET(new Request(`${url}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`))).status).toBe(403);
    expect((await GET(new Request(`${url}?hub.mode=unsubscribe&hub.verify_token=${VERIFY}&hub.challenge=1`))).status).toBe(403);
  });
  it('does not exist while the watcher switch or a value is missing', async () => {
    vi.stubEnv('DNESKAI_ENGAGEMENT_ENABLED', '');
    expect((await GET(new Request(`${url}?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=1`))).status).toBe(404);
    vi.stubEnv('DNESKAI_ENGAGEMENT_ENABLED', 'true'); vi.stubEnv('MARKETING_INSTAGRAM_APP_SECRET', '');
    expect((await POST(post(body([comment('1801')])))).status).toBe(404);
  });
});

describe('POST /api/webhooks/instagram (comments)', () => {
  it('refuses a bad or missing signature with 401 and hands nothing on', async () => {
    const raw = body([comment('1801')]);
    expect((await POST(post(raw, sign(raw, 'another-secret-TEST-ONLY-0000')))).status).toBe(401);
    expect((await POST(post(raw, null))).status).toBe(401);
    expect((await POST(post(raw, sign(`${raw} `)))).status).toBe(401);
    expect(mocks.after).toHaveLength(0);
  });
  it('answers 200 at once, then hands each comment once to the matcher after the response', async () => {
    const raw = body([comment('1801'), comment('1801'), comment('1802', 'díky')]);
    const response = await POST(post(raw));
    expect(response.status).toBe(200);
    expect(mocks.handle).not.toHaveBeenCalled();
    await mocks.after[0]!();
    expect(mocks.handle).toHaveBeenCalledWith(expect.objectContaining({ events: [{ commentId: '1801', mediaId: '1790000000000001', text: 'SKILL' }, { commentId: '1802', mediaId: '1790000000000001', text: 'díky' }] }));
  });
  it('acknowledges a body without comments and schedules nothing', async () => {
    const raw = JSON.stringify({ object: 'instagram', entry: [{ id: '1', time: 1, field: 'mentions', value: {} }] });
    expect((await POST(post(raw))).status).toBe(200);
    expect(mocks.after).toHaveLength(0);
    expect(instagramCommentEvents({ object: 'page', entry: [] })).toEqual([]);
  });
});

describe('a delivered comment and polling share one reply (#161)', () => {
  it('answers a webhook comment once, and a second delivery or the polling pass never answers it again', async () => {
    const real = (await vi.importActual<typeof import('@/lib/marketing/dneskai-engagement-watch')>('@/lib/marketing/dneskai-engagement-watch')).handleDneskaiCommentEvents;
    void handleDneskaiCommentEvents;
    const claimed = new Set<string>();
    const target: EngagementTarget = { publicationId: '22222222-2222-4222-8222-222222222222', mediaId: '1790000000000001', accountId: '33333333-3333-4333-8333-333333333333', igUserId: '17841400000000001',
      scheduledAt: new Date().toISOString(), keyword: 'SKILL', replyMessage: 'Text.', publicReply: null, check: { afterCursor: null, passSeen: 0, passMatches: 0, passSkippedOld: 0 } };
    const store: EngagementStore = { targets: async () => [target], claim: async ({ commentId }) => !claimed.has(commentId) && !!claimed.add(commentId), finish: async () => {}, saveCheck: async () => {}, blockAccount: async () => {} };
    const privateReply = vi.fn(async () => {});
    const graph = { comments: vi.fn(), privateReply, publicReply: vi.fn() };
    const events = instagramCommentEvents(JSON.parse(body([comment('1801'), comment('1803', 'skills'), comment('1804', 'skill', '1790000000000009')])));
    const first = await real({ store, graph, now: () => new Date(), signal: new AbortController().signal, events });
    expect(first).toMatchObject({ comments: 2, matches: 1, sent: 1 });
    const again = await real({ store, graph, now: () => new Date(), signal: new AbortController().signal, events });
    expect(again).toMatchObject({ matches: 1, sent: 0 });
    expect(privateReply).toHaveBeenCalledTimes(1);
  });
});
