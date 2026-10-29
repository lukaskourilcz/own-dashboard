import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { refreshCareer, CareerRefreshError } from '@/lib/jobs/refresh-client';
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const receipt = () => ({ ownerId: owner, startedAt: '2026-10-25T12:00:00Z', finishedAt: '2026-10-25T12:00:00.100Z', ok: true, inserted: 1, refreshed: 2, pruned: 0, sources: { curated: { count: 3 }, remoteok: { count: 0, error: 'source-unavailable' }, 'apify-owner~Task_ABC': { count: 1 } } });
let parent: AbortController, network: ReturnType<typeof vi.fn>;
beforeEach(() => { parent = new AbortController(); network = vi.fn().mockResolvedValue(Response.json(receipt())); vi.stubGlobal('fetch', network); });
afterEach(() => { parent.abort(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
const run = (ownerId = owner) => refreshCareer({ ownerId, signal: parent.signal });
it('confirms one captured-owner attempt and retires its transport without an auth call', async () => {
 await run(); expect(network).toHaveBeenCalledOnce(); const [url, init] = network.mock.calls[0]; expect(url).toBe('/api/jobs/refresh'); expect(new Headers(init.headers).get('x-own-dashboard-owner')).toBe(owner); expect(init).toMatchObject({ method: 'POST', cache: 'no-store', credentials: 'same-origin', redirect: 'error' }); expect(init.signal.aborted).toBe(true);
});
it.each(['foreign', 'empty', 'false', 'negative', 'fraction', 'unsafe', 'backwards', 'empty-sources', 'only-errors', 'extra', 'bad-json', 'oversized'] as const)('rejects unconfirmed receipt: %s', async kind => {
 const base = receipt(); let body: unknown = base;
 if (kind === 'foreign') body = { ...base, ownerId: other };
 if (kind === 'empty') body = {};
 if (kind === 'false') body = { ...base, ok: false };
 if (kind === 'negative') body = { ...base, inserted: -1 };
 if (kind === 'fraction') body = { ...base, refreshed: 0.5 };
 if (kind === 'unsafe') body = { ...base, pruned: Number.MAX_SAFE_INTEGER + 1 };
 if (kind === 'backwards') body = { ...base, finishedAt: '2026-10-25T11:59:59Z' };
 if (kind === 'empty-sources') body = { ...base, sources: {} };
 if (kind === 'only-errors') body = { ...base, sources: { remoteok: { count: 0, error: 'unavailable' } } };
 if (kind === 'extra') body = { ...base, unexpected: 'PRIVATE TEST' };
 network.mockResolvedValue(kind === 'bad-json' ? new Response('{') : kind === 'oversized' ? new Response(' '.repeat(65_537)) : Response.json(body));
 await expect(run()).rejects.toMatchObject({ reason: 'unconfirmed', message: 'Career refresh unconfirmed' }); expect(network).toHaveBeenCalledOnce();
});
it.each([401, 409, 429, 500, 503])('keeps HTTP %s fixed and does not parse/retain a provider body', async status => {
 const cancel = vi.fn(); network.mockResolvedValue(new Response(new ReadableStream({ pull() {}, cancel }), { status }));
 await expect(run()).rejects.toMatchObject({ reason: status === 429 ? 'rate-limited' : 'unconfirmed' }); expect(cancel).toHaveBeenCalledOnce();
});
it.each(['', 'not-an-owner', ` ${owner}`])('refuses invalid captured identity (%#) before transport', async value => { await expect(run(value)).rejects.toBeInstanceOf(CareerRefreshError); expect(network).not.toHaveBeenCalled(); });
it('refuses already-cancelled work before transport', async () => { parent.abort(); await expect(run()).rejects.toMatchObject({ name: 'AbortError' }); expect(network).not.toHaveBeenCalled(); });
it('releases a late response after parent cancellation without another attempt', async () => {
 let finish!: (value: Response) => void; network.mockImplementation(() => new Promise(resolve => { finish = resolve; })); const cancel = vi.fn(); const pending = run(), check = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); parent.abort(); await check; finish(new Response(new ReadableStream({ cancel }))); await new Promise(resolve => setTimeout(resolve, 0)); expect(cancel).toHaveBeenCalledOnce(); expect(network).toHaveBeenCalledOnce();
});
it.each(['transport', 'body'] as const)('bounds an uncooperative %s at sixty seconds and releases the body', async phase => {
 vi.useFakeTimers(); vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => { const controller = new AbortController(); setTimeout(() => controller.abort(), ms); return controller.signal; });
 const cancel = vi.fn(); network.mockImplementation(() => phase === 'transport' ? new Promise(() => {}) : Promise.resolve(new Response(new ReadableStream({ pull() {}, cancel }))));
 const pending = run(), check = expect(pending).rejects.toMatchObject({ reason: 'unconfirmed' }); await vi.advanceTimersByTimeAsync(60_001); await check; expect(network).toHaveBeenCalledOnce(); if (phase === 'body') expect(cancel).toHaveBeenCalledOnce();
});
