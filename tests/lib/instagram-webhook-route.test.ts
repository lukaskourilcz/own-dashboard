import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ after: [] as Array<() => Promise<void>>, handle: vi.fn(), admin: vi.fn(() => ({})) }));
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: (task: () => Promise<void>) => { mocks.after.push(task); } }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
vi.mock('@/lib/marketing/dneskai-engagement-ports', () => ({ createDneskaiEngagementStore: () => ({ kind: 'store' }), createDneskaiEngagementGraph: () => ({ kind: 'graph' }) }));
vi.mock('@/lib/marketing/dneskai-engagement-watch', async (actual) => ({ ...(await actual<typeof import('@/lib/marketing/dneskai-engagement-watch')>()), handleDneskaiCommentEvents: mocks.handle }));
import { MARKETING_BODY_TIMEOUT_MS } from '@/lib/marketing/http';
import { GET, POST } from '@/app/api/webhooks/instagram/route';
import { handleDneskaiCommentEvents, type EngagementStore, type EngagementTarget } from '@/lib/marketing/dneskai-engagement-watch';
import { INSTAGRAM_WEBHOOK_MAX_BYTES, instagramCommentEvents } from '@/lib/marketing/dneskai-instagram-webhook';

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
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

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


describe('bounded unauthenticated webhook upload', () => {
  it('counts actual UTF-8 bytes rather than JavaScript characters', async () => {
    const raw = body([comment('1801')]).replace(/}$/, `,"padding":"${'á'.repeat(INSTAGRAM_WEBHOOK_MAX_BYTES / 2)}"}`);
    expect(raw.length).toBeLessThan(INSTAGRAM_WEBHOOK_MAX_BYTES);
    expect(Buffer.byteLength(raw)).toBeGreaterThan(INSTAGRAM_WEBHOOK_MAX_BYTES);
    expect((await POST(post(raw))).status).toBe(413); expect(mocks.after).toHaveLength(0); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('refuses invalid UTF-8 instead of authenticating replacement text', async () => {
    const raw = new Uint8Array([0xc3, 0x28]);
    const signature = sign(new TextDecoder().decode(raw));
    const request = new Request(url, { method: 'POST', body: raw, headers: { 'X-Hub-Signature-256': signature } });
    expect((await POST(request)).status).toBe(400); expect(mocks.after).toHaveLength(0);
  });
});

const streamPost = (stream: ReadableStream<Uint8Array>, headers: Record<string, string> = {}, signal?: AbortSignal) => new Request(url, { method: 'POST', body: stream, duplex: 'half', headers, signal } as RequestInit & { duplex: 'half' });
describe('webhook stream lifetime', () => {
  it('stops at the first oversized chunk even when cancellation never settles', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const request = streamPost(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(INSTAGRAM_WEBHOOK_MAX_BYTES + 1)); }, cancel }));
    expect((await POST(request)).status).toBe(413); expect(cancel).toHaveBeenCalledOnce(); expect(request.body?.locked).toBe(false); expect(mocks.after).toHaveLength(0);
  });
  it('discards a declared oversized body without reading it or awaiting cancellation', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {})), pull = vi.fn();
    const request = streamPost(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), { 'content-length': String(INSTAGRAM_WEBHOOK_MAX_BYTES + 1) });
    expect((await POST(request)).status).toBe(413); expect(pull).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce(); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('applies one five-second deadline across a slow drip and releases the reader', async () => {
    vi.useFakeTimers(); let producer!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const request = streamPost(new ReadableStream({ start(controller) { producer = controller; }, cancel }));
    const response = POST(request); await vi.advanceTimersByTimeAsync(MARKETING_BODY_TIMEOUT_MS - 1);
    producer.enqueue(new TextEncoder().encode('{')); await vi.advanceTimersByTimeAsync(1);
    expect((await response).status).toBe(408); expect(cancel).toHaveBeenCalledOnce(); expect(request.body?.locked).toBe(false); expect(mocks.after).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('refuses a disconnected request and never schedules late work', async () => {
    const abort = new AbortController(), cancel = vi.fn();
    const request = streamPost(new ReadableStream({ cancel }), {}, abort.signal), response = POST(request);
    abort.abort('PRIVATE TEST reason'); const result = await response;
    expect(result.status).toBe(400); expect(await result.text()).toBe(''); expect(cancel).toHaveBeenCalledOnce(); expect(request.body?.locked).toBe(false); expect(mocks.after).toHaveLength(0);
  });
  it('discards an already aborted body without taking a reader', async () => {
    const abort = new AbortController(); abort.abort(); const cancel = vi.fn();
    const request = streamPost(new ReadableStream({ cancel }), {}, abort.signal);
    expect((await POST(request)).status).toBe(400); expect(cancel).toHaveBeenCalledOnce(); expect(request.body?.locked).toBe(false); expect(mocks.after).toHaveLength(0);
  });
  it('validates the exact signed text across split multi-byte characters', async () => {
    const raw = body([comment('1801', 'díky 😀')]), bytes = new TextEncoder().encode(raw);
    const request = streamPost(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } }), { 'x-hub-signature-256': sign(raw) });
    expect((await POST(request)).status).toBe(200); expect(mocks.after).toHaveLength(1); expect(request.body?.locked).toBe(false);
    await mocks.after[0]!(); expect(mocks.handle).toHaveBeenCalledWith(expect.objectContaining({ events: [{ commentId: '1801', mediaId: '1790000000000001', text: 'díky 😀' }] }));
  });
  it('keeps exact-limit signed uploads and signed malformed JSON acknowledgement unchanged', async () => {
    const base = body([comment('1801')]), exact = base + ' '.repeat(INSTAGRAM_WEBHOOK_MAX_BYTES - Buffer.byteLength(base));
    expect((await POST(post(exact))).status).toBe(200); expect(mocks.after).toHaveLength(1); mocks.after.length = 0;
    expect((await POST(post('{'))).status).toBe(200); expect(mocks.after).toHaveLength(0);
  });
  it('returns a fixed refusal for a missing or failed body', async () => {
    expect((await POST(new Request(url, { method: 'POST' }))).status).toBe(400);
    const result = await POST(streamPost(new ReadableStream({ pull(controller) { controller.error(new Error('PRIVATE TEST producer error')); } })));
    expect(result.status).toBe(400); expect(await result.text()).toBe(''); expect(mocks.after).toHaveLength(0);
  });
});
