import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ user: vi.fn(), create: vi.fn(), rate: vi.fn(), admin: vi.fn(), read: vi.fn(), retry: vi.fn(), querySignal: vi.fn(), edited: vi.fn(), preview: vi.fn(), media: vi.fn(), list: vi.fn(), pool: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: (signal: AbortSignal) => m.create(signal) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: m.admin }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: m.rate }));
vi.mock('@/lib/marketing/dneskai-revision-edit', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/marketing/dneskai-revision-edit')>(), editedDneskaiDeck: m.edited }));
vi.mock('@/lib/marketing/dneskai-render', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/marketing/dneskai-render')>(), previewDneskaiSlide: m.preview }));
vi.mock('@/lib/marketing/dneskai-wiring', () => ({ getDneskaiMediaLoader: m.media, getBriefAssetHashLister: m.list, getBriefPoolLoader: m.pool }));
import { POST } from '@/app/api/marketing/dneskai/preview/route';
import { POST as fixturePreview } from '@/app/api/dev-preview/dneskai-preview/route';
import { deckRevision } from './marketing-dneskai-revision-fixture';
import { createClient as createSdkClient } from '@supabase/supabase-js';
import { fetchWithSignal } from '@/lib/abortable';
const owner = '11111111-1111-4111-8111-111111111111';
const request = (signal?: AbortSignal) => new Request('https://fixture.invalid/api/marketing/dneskai/preview', { method: 'POST', headers: { Origin: 'https://fixture.invalid', 'Content-Type': 'application/json' }, signal, body: '{}' });
beforeEach(() => {
  vi.resetAllMocks(); m.user.mockResolvedValue({ data: { user: { id: owner } }, error: null });
  m.create.mockImplementation(() => ({ auth: { getUser: m.user }, from: () => {
    const query = { select: () => query, eq: () => query, retry: (value: boolean) => { m.retry(value); return query; }, abortSignal: (signal: AbortSignal) => { m.querySignal(signal); return query; }, maybeSingle: m.read }; return query;
  } }));
  m.rate.mockResolvedValue({ ok: false, retryAfter: 7 }); m.admin.mockReturnValue({});
  m.read.mockResolvedValue({ data: { revision: deckRevision() }, error: null });
  m.edited.mockResolvedValue(deckRevision().deck); m.preview.mockResolvedValue({ status: 'rendered', image: Buffer.from('TEST_ONLY_WEBP_BYTES'), problems: [] });
  m.media.mockReturnValue(vi.fn()); m.list.mockReturnValue(vi.fn()); m.pool.mockReturnValue(vi.fn());
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it('admits no preview/rate work for a cached user with an auth error', async () => {
  m.user.mockResolvedValue({ data: { user: { id: owner } }, error: { status: 401, message: 'TEST_ONLY_PRIVATE_AUTH' } });
  const response = await POST(request()); expect(response.status).toBe(401); expect(m.rate).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled();
});
it('contains rejected authentication with fixed unavailable feedback', async () => {
  m.user.mockRejectedValue(Error('TEST_ONLY_PRIVATE_AUTH'));
  const response = await POST(request()); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'render-unavailable' }); expect(m.rate).not.toHaveBeenCalled();
});
it('starts no setup for a retired original preview request', async () => {
  const caller = new AbortController(); caller.abort('TEST_ONLY_PRIVATE_REASON');
  expect((await POST(request(caller.signal))).status).toBe(503); expect(m.create).not.toHaveBeenCalled(); expect(m.rate).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled();
});
function validRequest(signal?: AbortSignal) {
  const input = { id: '22222222-2222-4222-8222-222222222222', deck: { slides: deckRevision().deck!.slides.map((_, from) => ({ from })) }, slide: 0 };
  return new Request('https://fixture.invalid/api/marketing/dneskai/preview', { method: 'POST', headers: { Origin: 'https://fixture.invalid', 'Content-Type': 'application/json' }, signal, body: JSON.stringify(input) });
}
function clocks() {
  const values = new Map<number, AbortController[]>(); vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => { const controller = new AbortController(); values.set(ms, [...values.get(ms) ?? [], controller]); return controller.signal; }); return values;
}
it('keeps one original read and a scoped admin only after a confirmed revision', async () => {
  m.rate.mockResolvedValue({ ok: true, retryAfter: 0 }); const response = await POST(validRequest());
  expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('private, no-store'); expect(await response.json()).toMatchObject({ draft: true, slide: 0, status: 'rendered' });
  expect(m.retry).toHaveBeenCalledExactlyOnceWith(false); expect(m.querySignal.mock.calls[0]![0]).toBeInstanceOf(AbortSignal); expect(m.admin.mock.calls[0]![0]).toBeInstanceOf(AbortSignal); expect(m.preview).toHaveBeenCalledOnce();
});
it('distinguishes auth outage, positive absence, database failure and corrupt revision', async () => {
  m.user.mockResolvedValueOnce({ data: { user: { id: owner } }, error: { status: 503 } }); expect((await POST(request())).status).toBe(503);
  m.rate.mockResolvedValue({ ok: true, retryAfter: 0 });
  m.read.mockResolvedValueOnce({ data: null, error: null }); expect((await POST(validRequest())).status).toBe(404);
  m.read.mockResolvedValueOnce({ data: null, error: { message: 'TEST_ONLY_PRIVATE_QUERY' } }); expect((await POST(validRequest())).status).toBe(503);
  m.read.mockResolvedValueOnce({ data: { revision: {} }, error: null }); expect((await POST(validRequest())).status).toBe(503); expect(m.admin).not.toHaveBeenCalled(); expect(m.preview).not.toHaveBeenCalled();
});
it('bounds the rate wait and ignores late permission without starting a read', async () => {
  const timers = clocks(); let finish!: (value: unknown) => void; m.rate.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = POST(validRequest()); await vi.waitFor(() => expect(m.rate).toHaveBeenCalledOnce()); timers.get(3000)![0]!.abort();
  expect((await pending).status).toBe(503); finish({ ok: true, retryAfter: 0 }); await Promise.resolve(); expect(m.read).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled();
});
it('retires a held owned read before admin, metadata or native work', async () => {
  const caller = new AbortController(); let finish!: (value: unknown) => void; m.rate.mockResolvedValue({ ok: true, retryAfter: 0 }); m.read.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = POST(validRequest(caller.signal)); await vi.waitFor(() => expect(m.read).toHaveBeenCalledOnce()); caller.abort();
  expect((await pending).status).toBe(503); expect(m.querySignal.mock.calls[0]![0].aborted).toBe(true); finish({ data: { revision: deckRevision() }, error: null }); await Promise.resolve(); expect(m.admin).not.toHaveBeenCalled(); expect(m.edited).not.toHaveBeenCalled(); expect(m.preview).not.toHaveBeenCalled();
});
it('keeps original time through metadata preparation and ignores its late deck', async () => {
  const timers = clocks(); let finish!: (value: unknown) => void; m.rate.mockResolvedValue({ ok: true, retryAfter: 0 }); m.edited.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = POST(validRequest()); await vi.waitFor(() => expect(m.edited).toHaveBeenCalledOnce()); timers.get(15_000)![0]!.abort();
  expect((await pending).status).toBe(503); expect(m.admin.mock.calls[0]![0].aborted).toBe(true); finish(deckRevision().deck); await Promise.resolve(); expect(m.preview).not.toHaveBeenCalled();
});
it('retains the eight-second render phase within the original fifteen seconds', async () => {
  const timers = clocks(); let finish!: (value: unknown) => void; m.rate.mockResolvedValue({ ok: true, retryAfter: 0 }); m.preview.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = POST(validRequest()); await vi.waitFor(() => expect(m.preview).toHaveBeenCalledOnce()); timers.get(8000)![0]!.abort();
  const response = await pending; expect(response.status).toBe(504); expect(await response.json()).toEqual({ error: 'worker-timeout' }); finish({ status: 'rendered', image: Buffer.from('TEST_ONLY_LATE_BYTES'), problems: [] }); await Promise.resolve(); expect(m.preview).toHaveBeenCalledOnce();
});
function streamed(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  const init = { method: 'POST', headers: { Origin: 'https://fixture.invalid', 'Content-Type': 'application/json' }, body, signal, duplex: 'half' }; return new Request('https://fixture.invalid/api/marketing/dneskai/preview', init);
}
it('bounds actual bytes before EOF and preserves the old forty-thousand-character policy', async () => {
  m.rate.mockResolvedValue({ ok: true, retryAfter: 0 }); const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(' '.repeat(160_001))); }, cancel });
  expect((await POST(streamed(body))).status).toBe(400); expect(cancel).toHaveBeenCalledOnce();
  const tooLong = new Request('https://fixture.invalid/api/marketing/dneskai/preview', { method: 'POST', headers: { Origin: 'https://fixture.invalid' }, body: ' '.repeat(40_001) + '{}' });
  expect((await POST(tooLong)).status).toBe(400); expect(m.read).not.toHaveBeenCalled(); expect(m.preview).not.toHaveBeenCalled();
});
it.each([false, true])('bounds the held body in the owner/fixture handler (fixture=%s)', async fixture => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); m.rate.mockResolvedValue({ ok: true, retryAfter: 0 }); const cancel = vi.fn(), body = new ReadableStream<Uint8Array>({ cancel });
  const pending = (fixture ? fixturePreview : POST)(streamed(body)); await vi.waitFor(() => expect(body.locked).toBe(true)); await vi.advanceTimersByTimeAsync(5000);
  const response = await pending; expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'render-unavailable' }); expect(cancel).toHaveBeenCalledOnce(); expect(m.read).not.toHaveBeenCalled(); expect(m.preview).not.toHaveBeenCalled(); if (fixture) expect(m.create).not.toHaveBeenCalled();
});
it('makes one actual SDK request on a read outage, with no admin or render admission', async () => {
  m.rate.mockResolvedValue({ ok: true, retryAfter: 0 }); const fetcher = vi.fn(async () => Response.json({ message: 'TEST_ONLY_PRIVATE_DATABASE' }, { status: 503 }));
  m.create.mockImplementation((signal: AbortSignal) => { const db = createSdkClient('https://preview-lifetime.supabase.co', 'TEST-ONLY-PUBLISHABLE', { global: { fetch: fetchWithSignal(signal, fetcher) }, auth: { persistSession: false, autoRefreshToken: false } }); vi.spyOn(db.auth, 'getUser').mockResolvedValue({ data: { user: { id: owner, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-10-28T00:00:00Z' } }, error: null }); return db; });
  const response = await POST(validRequest()); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'render-unavailable' }); expect(fetcher).toHaveBeenCalledOnce(); expect(m.admin).not.toHaveBeenCalled(); expect(m.preview).not.toHaveBeenCalled();
});
