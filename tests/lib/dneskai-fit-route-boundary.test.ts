import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ user: vi.fn(), create: vi.fn(), rate: vi.fn(), fit: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: (signal: AbortSignal) => m.create(signal) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: m.rate }));
vi.mock('@/lib/marketing/dneskai-render', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/marketing/dneskai-render')>(), dneskaiSlideTextProblems: m.fit }));
import { POST } from '@/app/api/marketing/dneskai/fit/route';
import { POST as fixtureFit } from '@/app/api/dev-preview/dneskai-fit/route';
import { createDneskaiWorkspaceFixture } from '@/lib/demo/dneskai-workspace-fixtures';
import { dneskaiFitSlide } from '@/lib/marketing/dneskai-lab';
const owner = '11111111-1111-4111-8111-111111111111';
const body = () => ({ kit: 'editorial', slides: createDneskaiWorkspaceFixture(new Date('2026-10-28T09:00:00Z')).posts[0]!.deck!.slides.map(dneskaiFitSlide) });
const request = (signal?: AbortSignal) => new Request('https://fixture.invalid/api/marketing/dneskai/fit', { method: 'POST', headers: { Origin: 'https://fixture.invalid', 'Content-Type': 'application/json' }, signal, body: JSON.stringify(body()) });
beforeEach(() => { vi.resetAllMocks(); m.user.mockResolvedValue({ data: { user: { id: owner } }, error: null }); m.create.mockImplementation(() => ({ auth: { getUser: m.user } })); m.rate.mockResolvedValue({ ok: true, retryAfter: 0 }); m.fit.mockResolvedValue([]); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it('admits no fit or rate work for a cached user with an auth error', async () => {
  m.user.mockResolvedValue({ data: { user: { id: owner } }, error: { status: 401, message: 'TEST_ONLY_PRIVATE_AUTH' } });
  const response = await POST(request()); expect(response.status).toBe(401); expect(m.rate).not.toHaveBeenCalled(); expect(m.fit).not.toHaveBeenCalled();
});
it('contains rejected authentication with fixed unavailable feedback', async () => {
  m.user.mockRejectedValue(Error('TEST_ONLY_PRIVATE_AUTH'));
  const response = await POST(request()); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'fit-unavailable' }); expect(m.rate).not.toHaveBeenCalled();
});
it('starts no setup for a retired original request', async () => {
  const caller = new AbortController(); caller.abort('TEST_ONLY_PRIVATE_REASON');
  expect((await POST(request(caller.signal))).status).toBe(503); expect(m.create).not.toHaveBeenCalled(); expect(m.rate).not.toHaveBeenCalled(); expect(m.fit).not.toHaveBeenCalled();
});
function clocks() {
  const values = new Map<number, AbortController[]>();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => { const controller = new AbortController(); values.set(ms, [...values.get(ms) ?? [], controller]); return controller.signal; });
  return values;
}
it('preserves missing-session, outage and rate-limit distinctions', async () => {
  m.user.mockResolvedValueOnce({ data: { user: null }, error: null }); expect((await POST(request())).status).toBe(401);
  m.user.mockResolvedValueOnce({ data: { user: { id: owner } }, error: { status: 503 } }); expect((await POST(request())).status).toBe(503);
  m.rate.mockResolvedValueOnce({ ok: false, retryAfter: 7 }); const response = await POST(request()); expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBe('7'); expect(m.fit).not.toHaveBeenCalled();
});
it('retires stalled authentication without starting a rate or fit phase', async () => {
  const timers = clocks(); let finish!: (value: unknown) => void; m.user.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = POST(request()); await vi.waitFor(() => expect(m.user).toHaveBeenCalledOnce()); timers.get(10_000)![1]!.abort();
  expect((await pending).status).toBe(503); expect(m.create.mock.calls[0]![0].aborted).toBe(true); finish({ data: { user: { id: owner } }, error: null }); await Promise.resolve(); expect(m.rate).not.toHaveBeenCalled(); expect(m.fit).not.toHaveBeenCalled();
});
it('bounds the rate consumer to three seconds and ignores a late admission', async () => {
  const timers = clocks(); let finish!: (value: unknown) => void; m.rate.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const incoming = request(), pending = POST(incoming); await vi.waitFor(() => expect(m.rate).toHaveBeenCalledOnce()); timers.get(3000)![0]!.abort();
  const response = await pending; expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'fit-unavailable' });
  finish({ ok: true, retryAfter: 0 }); await Promise.resolve(); expect(incoming.bodyUsed).toBe(false); expect(m.fit).not.toHaveBeenCalled(); expect(m.rate).toHaveBeenCalledOnce();
});
it('keeps the original ten-second allowance through fitting rather than restarting it', async () => {
  const timers = clocks(), finish: Array<() => void> = []; m.fit.mockImplementation(() => new Promise(resolve => { finish.push(() => resolve([])); }));
  const pending = POST(request()); await vi.waitFor(() => expect(m.fit).toHaveBeenCalled()); timers.get(10_000)![0]!.abort();
  const response = await pending; expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'fit-unavailable' }); expect(timers.get(10_000)).toHaveLength(2); for (const release of finish) release(); await Promise.resolve();
});
function streamed(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  const init = { method: 'POST', headers: { Origin: 'https://fixture.invalid', 'Content-Type': 'application/json' }, body, signal, duplex: 'half' };
  return new Request('https://fixture.invalid/api/marketing/dneskai/fit', init);
}
it('refuses actual oversized streamed bytes before EOF and fitting', async () => {
  const cancel = vi.fn(), incoming = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(' '.repeat(80_001))); }, cancel });
  const response = await POST(streamed(incoming)); expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: 'invalid-request' }); expect(cancel).toHaveBeenCalledOnce(); expect(m.fit).not.toHaveBeenCalled();
});
it('bounds a held body to five seconds and never starts fitting', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); const cancel = vi.fn(), incoming = new ReadableStream<Uint8Array>({ cancel });
  const pending = POST(streamed(incoming)); await vi.waitFor(() => expect(incoming.locked).toBe(true)); await vi.advanceTimersByTimeAsync(5000);
  const response = await pending; expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'fit-unavailable' }); expect(cancel).toHaveBeenCalledOnce(); expect(m.fit).not.toHaveBeenCalled();
});
it('retires a held body even if producer cancellation never resolves', async () => {
  const caller = new AbortController(), cancel = vi.fn(() => new Promise<void>(() => {})), incoming = new ReadableStream<Uint8Array>({ cancel });
  const pending = POST(streamed(incoming, caller.signal)); await vi.waitFor(() => expect(incoming.locked).toBe(true)); caller.abort('TEST_ONLY_PRIVATE_REASON');
  expect((await pending).status).toBe(503); expect(cancel).toHaveBeenCalledOnce(); expect(m.fit).not.toHaveBeenCalled();
});
it('refuses malformed UTF-8 and retains the existing twenty-thousand-character limit', async () => {
  const init = { method: 'POST', headers: { Origin: 'https://fixture.invalid', 'Content-Type': 'application/json' }, body: new Uint8Array([0xc3, 0x28]) };
  expect((await POST(new Request('https://fixture.invalid/api/marketing/dneskai/fit', init))).status).toBe(400);
  expect((await POST(new Request('https://fixture.invalid/api/marketing/dneskai/fit', { ...init, body: ' '.repeat(20_001) + JSON.stringify(body()) }))).status).toBe(400); expect(m.fit).not.toHaveBeenCalled();
});
it('uses the same bounded body reader in the fixture twin without identity or private work', async () => {
  const caller = new AbortController(), cancel = vi.fn(), incoming = new ReadableStream<Uint8Array>({ cancel });
  const pending = fixtureFit(streamed(incoming, caller.signal)); await vi.waitFor(() => expect(incoming.locked).toBe(true)); caller.abort();
  expect((await pending).status).toBe(503); expect(cancel).toHaveBeenCalledOnce(); expect(m.create).not.toHaveBeenCalled(); expect(m.rate).not.toHaveBeenCalled(); expect(m.fit).not.toHaveBeenCalled();
});
it('contains a native fitting failure with fixed diagnostics', async () => {
  m.fit.mockRejectedValue(Error('TEST_ONLY_PRIVATE_FITTER_DETAIL'));
  const response = await POST(request()); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'fit-unavailable' });
});
