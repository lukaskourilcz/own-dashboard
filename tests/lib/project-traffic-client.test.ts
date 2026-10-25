import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { loadProjectTraffic } from '@/lib/project-traffic-client';
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const ok = () => ({ kind: 'ok', projectId: 'prj_example', lifetime: { pageviews: 200, visitors: 120 }, last30: { pageviews: 100, visitors: 65 }, daily: [{ date: '2026-10-01', pageviews: 50, visitors: 40 }, { date: '2026-10-25', pageviews: 50, visitors: 40 }], window: { since: '2026-09-26', until: '2026-10-25' }, checkedAt: '2026-10-25T12:00:00Z' });
const call = (signal = new AbortController().signal) => loadProjectTraffic(owner, 'owner/repo', 123, signal);
beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ownerId: owner, traffic: ok() }))));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('uses a captured owner header, cancellation and a typed private response', async () => {
 expect(await call()).toEqual(ok()); expect(fetch).toHaveBeenCalledWith('/api/vercel/analytics?repo=owner%2Frepo&repoId=123', expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal), headers: { 'x-own-dashboard-owner': owner } }));
});
it.each(['unconfigured', 'not-found'])('preserves a valid %s state', async kind => {
 vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ownerId: owner, traffic: { kind } }))); expect(await call()).toEqual({ kind });
});
it.each([{ ownerId: other, traffic: ok() }, { ownerId: owner, traffic: { kind: 'error' } }, { traffic: ok() }, { ownerId: owner, traffic: { ...ok(), private: 'PRIVATE TEST metadata' } }, { ownerId: owner, traffic: { ...ok(), last30: { pageviews: 101, visitors: 65 } } }, { ownerId: owner, traffic: { ...ok(), last30: { pageviews: 100, visitors: 1 } } }, { ownerId: owner, traffic: { ...ok(), daily: [...ok().daily, ok().daily[0]] } }, { ownerId: owner, traffic: { ...ok(), window: { since: '2026-01-01', until: '2026-10-25' } } }])('refuses wrong-owner, partial or inconsistent successful data', async body => {
 vi.stubGlobal('fetch', vi.fn(async () => Response.json(body))); await expect(call()).rejects.toThrow(/^Traffic unavailable$/);
});
it('discards a non-success body without consuming private errors', async () => {
 const cancel = vi.fn(), pull = vi.fn(); vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ cancel, pull }, { highWaterMark: 0 }), { status: 503 })));
 await expect(call()).rejects.toThrow(/^Traffic unavailable$/); expect(cancel).toHaveBeenCalledOnce(); expect(pull).not.toHaveBeenCalled();
});
it('enforces the actual UTF-8 response-byte bound', async () => {
 vi.stubGlobal('fetch', vi.fn(async () => new Response('á'.repeat(16_385)))); await expect(call()).rejects.toThrow(/^Traffic unavailable$/);
});
it('ends an uncooperative header wait on its deadline and releases late response bodies', async () => {
 vi.useFakeTimers(); vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => { const stop = new AbortController(); setTimeout(() => stop.abort(), ms); return stop.signal; }); let release!: (response: Response) => void; const cancel = vi.fn(); vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { release = resolve; })));
 const pending = call(), rejected = expect(pending).rejects.toThrow(/^Traffic unavailable$/); await vi.advanceTimersByTimeAsync(20_001); await rejected;
 release(new Response(new ReadableStream({ cancel }))); await vi.advanceTimersByTimeAsync(0); expect(cancel).toHaveBeenCalledOnce();
});
it('aborts a pending stream promptly without waiting for its cancel hook', async () => {
 const stop = new AbortController(), cancel = vi.fn(() => new Promise<void>(() => {})); vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ cancel }))));
 const pending = call(stop.signal), rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); await Promise.resolve(); await Promise.resolve(); stop.abort('PRIVATE TEST reason'); await rejected; expect(cancel).toHaveBeenCalledOnce();
});
it('does not fetch for an already aborted owner lifetime', async () => {
 const stop = new AbortController(); stop.abort(); await expect(call(stop.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(fetch).not.toHaveBeenCalled();
});
