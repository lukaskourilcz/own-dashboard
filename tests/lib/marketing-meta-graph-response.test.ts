import { afterEach, expect, it, vi } from 'vitest';
import { metaGraphResponse } from '@/lib/marketing/meta-graph-response';
vi.mock('server-only', () => ({}));
const url = 'https://graph.instagram.com/v24.0/123/subscribed_apps';
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
afterEach(() => vi.restoreAllMocks());
it('reads one bounded complete JSON reply with the original no-retry fetch scope', async () => {
 const caller = new AbortController(), fetcher = vi.fn(async () => Response.json({ success: true }));
 expect(await metaGraphResponse(url, { method: 'POST', headers: { Authorization: 'Bearer TEST_ONLY_VALUE' } }, caller.signal, fetcher)).toEqual({ status: 200, body: { success: true } });
 expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0]).toEqual([url, expect.objectContaining({ method: 'POST', redirect: 'error', cache: 'no-store', signal: expect.any(AbortSignal) })]);
});
it('retains bounded structured provider refusals without treating status as success', async () => {
 expect(await metaGraphResponse(url, {}, new AbortController().signal, async () => Response.json({ error: { code: 190 } }, { status: 400 }))).toEqual({ status: 400, body: { error: { code: 190 } } });
});
it('starts no request for an already retired original scope', async () => {
 const caller = new AbortController(); caller.abort('TEST_ONLY_PRIVATE_REASON'); const fetcher = vi.fn();
 await expect(metaGraphResponse(url, {}, caller.signal, fetcher)).rejects.toMatchObject({ code: 'meta-request-uncertain', message: 'Meta request unavailable' }); expect(fetcher).not.toHaveBeenCalled();
});
it('bounds stalled headers and discards a late body without retry', async () => {
 const pending = deferred<Response>(), caller = new AbortController(), cancel = vi.fn(), fetcher = vi.fn(() => pending.promise);
 const outcome = metaGraphResponse(url, {}, caller.signal, fetcher).catch(error => error); caller.abort('TEST_ONLY_PRIVATE_REASON');
 expect(await outcome).toMatchObject({ code: 'meta-request-uncertain' }); pending.resolve(new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'application/json' } }));
 await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce()); expect(fetcher).toHaveBeenCalledOnce();
});
it('cancels a stalled body when the original scope ends', async () => {
 const caller = new AbortController(), started = deferred<void>(), cancel = vi.fn();
 const fetcher = vi.fn(async () => new Response(new ReadableStream({ pull() { started.resolve(); }, cancel }), { headers: { 'Content-Type': 'application/json' } }));
 const outcome = metaGraphResponse(url, {}, caller.signal, fetcher).catch(error => error); await started.promise; caller.abort();
 expect(await outcome).toMatchObject({ code: 'meta-request-uncertain' }); expect(cancel).toHaveBeenCalledOnce();
});
it('bounds the whole request and body with the same ten-second deadline', async () => {
 const deadline = new AbortController(); vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
 const fetcher = vi.fn(() => new Promise<Response>(() => {})), outcome = metaGraphResponse(url, {}, new AbortController().signal, fetcher).catch(error => error);
 expect(AbortSignal.timeout).toHaveBeenCalledWith(10_000); deadline.abort(); expect(await outcome).toMatchObject({ code: 'meta-request-uncertain' }); expect(fetcher).toHaveBeenCalledOnce();
});
it.each([
 () => new Response('{}', { headers: { 'Content-Type': 'text/html' } }),
 () => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': '99999999' } }),
 () => new Response(new Uint8Array([0xff]), { headers: { 'Content-Type': 'application/json' } }),
 () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
 () => new Response(null, { headers: { 'Content-Type': 'application/json' } }),
])('refuses malformed/incomplete response admission without private details: %#', async response => {
 await expect(metaGraphResponse(url, {}, new AbortController().signal, async () => response())).rejects.toMatchObject({ code: 'meta-invalid-response', message: 'Meta request unavailable' });
});
it('owns byte chunks even when the producer reuses its buffer', async () => {
 const bytes = new TextEncoder().encode('{"a":1}'), mutable = new Uint8Array(bytes.length); mutable.set(bytes); let count = 0;
 const stream = new ReadableStream({ pull(controller) { if (!count++) controller.enqueue(mutable); else { mutable.fill(120); controller.close(); } } }, { highWaterMark: 0 });
 expect((await metaGraphResponse(url, {}, new AbortController().signal, async () => new Response(stream, { headers: { 'Content-Type': 'application/json' } }))).body).toEqual({ a: 1 });
});
