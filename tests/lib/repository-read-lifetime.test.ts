import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { readRepoText, repositoryVisible, mapWithConcurrency, type GitHubFetch } from '@/lib/stack-detection-server';
import { readMarketingCalendars } from '@/lib/marketing-calendars-server';
import { MARKETING_CALENDAR_SOURCES } from '@/lib/marketing-calendars';
afterEach(() => vi.restoreAllMocks());
const shortWait = <T>(pending: Promise<T>) => Promise.race([pending, new Promise<'still waiting'>(resolve => setTimeout(() => resolve('still waiting'), 30))]);
it('bounds a complete file header/body phase even when a fetch adapter ignores its signal', async () => {
 const deadline = new AbortController(), timeout = AbortSignal.timeout;
 vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 8000 ? deadline.signal : timeout(ms));
 let stream!: ReadableStreamDefaultController<Uint8Array>, release!: () => void;
 const cancel = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
 const response = new Response(new ReadableStream({ start(controller) { stream = controller; }, cancel }));
 const fetcher: GitHubFetch = vi.fn(async () => response), pending = readRepoText(fetcher, 'me/repo', 'calendar.json', 100);
 await vi.waitFor(() => expect(response.body?.locked).toBe(true)); deadline.abort('TEST_ONLY_PRIVATE_REASON');
 let observed: unknown;
 try { observed = await shortWait(pending); }
 finally { if (response.body?.locked) stream.close(); release?.(); await pending; }
 expect(observed).toEqual({ kind: 'error', status: null }); expect(response.body?.locked).toBe(false); expect(cancel).toHaveBeenCalledOnce();
});
it('bounds an uncooperative file header and discards its late response body', async () => {
 const deadline = new AbortController(), timeout = AbortSignal.timeout;
 vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 8000 ? deadline.signal : timeout(ms));
 let finish!: (value: Response) => void;
 const fetcher: GitHubFetch = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })), pending = readRepoText(fetcher, 'me/repo', 'file.json');
 deadline.abort(); const observed = await shortWait(pending), cancel = vi.fn(); finish(new Response(new ReadableStream({ pull(controller) { controller.enqueue(new TextEncoder().encode('late')); controller.close(); }, cancel }, { highWaterMark: 0 })));
 await pending; await new Promise(resolve => setTimeout(resolve, 0));
 expect(observed).toEqual({ kind: 'error', status: null }); expect(cancel).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce();
});
it.each([401, 404, 503, 206])('disposes a refused %i file response without reading its body', async status => {
 const cancel = vi.fn(), response = new Response(new ReadableStream({ pull(controller) { controller.enqueue(new TextEncoder().encode('body')); controller.close(); }, cancel }, { highWaterMark: 0 }), { status });
 expect(await readRepoText(async () => response, 'me/repo', 'file.json')).not.toMatchObject({ kind: 'ok' }); expect(cancel).toHaveBeenCalledOnce(); expect(response.body?.locked).toBe(false);
});
it.each([200, 404, 403, 503])('disposes unused repository visibility metadata (%i)', async status => {
 const cancel = vi.fn(), response = new Response(new ReadableStream({ pull(controller) { controller.enqueue(new TextEncoder().encode('body')); controller.close(); }, cancel }, { highWaterMark: 0 }), { status });
 expect(await repositoryVisible(async () => response, 'me/repo')).toBe(status === 200 ? true : status === 503 ? null : false); expect(cancel).toHaveBeenCalledOnce();
});
it.each(['file', 'visibility'] as const)('starts no %s read for a retired parent', async kind => {
 const parent = new AbortController(); parent.abort(); const fetcher = vi.fn(async () => new Response('unused'));
 const result = kind === 'file' ? await readRepoText(fetcher, 'me/repo', 'file.json', 100, { signal: parent.signal }) : await repositoryVisible(fetcher, 'me/repo', parent.signal);
 expect(result).toEqual(kind === 'file' ? { kind: 'error', status: null } : null); expect(fetcher).not.toHaveBeenCalled();
});
it('applies the calendar whole-file ceiling to actual UTF-8 bytes rather than characters', async () => {
 const fetcher = vi.fn(async () => new Response('ČČČČ'));
 expect(await readRepoText(fetcher, 'me/repo', 'file.json', 100, { maxBytes: 6 })).toEqual({ kind: 'ok', text: '', truncated: true });
 expect(await readRepoText(async () => new Response('ČČČ'), 'me/repo', 'file.json', 100, { maxBytes: 6 })).toEqual({ kind: 'ok', text: 'ČČČ', truncated: false });
});
it('refuses declared excess before reading and rejects malformed whole-file UTF-8', async () => {
 const cancel = vi.fn(), response = new Response(new ReadableStream({ pull(controller) { controller.enqueue(new TextEncoder().encode('1234567')); controller.close(); }, cancel }, { highWaterMark: 0 }), { headers: { 'Content-Length': '7' } });
 expect(await readRepoText(async () => response, 'me/repo', 'file.json', 100, { maxBytes: 6 })).toEqual({ kind: 'ok', text: '', truncated: true }); expect(cancel).toHaveBeenCalledOnce();
 expect(await readRepoText(async () => new Response(new Uint8Array([255])), 'me/repo', 'file.json', 100, { maxBytes: 6 })).toEqual({ kind: 'error', status: null, reason: 'invalid-encoding' });
});
it('stops queued fan-out immediately after parent retirement', async () => {
 const parent = new AbortController(); let finish!: (value: number) => void;
 const work = vi.fn((n: number) => n === 0 ? new Promise<number>(resolve => { finish = resolve; }) : Promise.resolve(n));
 const pending = mapWithConcurrency([0, 1, 2], 1, work, parent.signal); parent.abort(); finish(0);
 let error: unknown; try { await pending; } catch (value) { error = value; }
 expect(error).toMatchObject({ name: 'AbortError' }); expect(work).toHaveBeenCalledOnce();
});
it('starts no visibility fallback after the original calendar caller retires', async () => {
 const parent = new AbortController(); let finish!: (value: Response) => void;
 let calls = 0; const fetcher = vi.fn(() => ++calls === 1 ? new Promise<Response>(resolve => { finish = resolve; }) : Promise.resolve(new Response('{}')));
 const pending = readMarketingCalendars(fetcher, [MARKETING_CALENDAR_SOURCES[0]], '2026-10-29T00:00:00Z', parent.signal);
 parent.abort('TEST_ONLY_PRIVATE_REASON'); finish(new Response(null, { status: 404 }));
 let error: unknown; try { await pending; } catch (value) { error = value; }
 expect(error).toMatchObject({ name: 'AbortError' }); expect(fetcher).toHaveBeenCalledOnce();
});

it('keeps the calendar fan-out inside one original twenty-second scope', async () => {
 const deadline = new AbortController(), timeout = AbortSignal.timeout;
 const clock = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 20_000 ? deadline.signal : timeout(ms));
 const streams: Array<ReadableStreamDefaultController<Uint8Array>> = [], responses: Response[] = [];
 const fetcher = vi.fn(async () => { const response = new Response(new ReadableStream({ start(controller) { streams.push(controller); } })); responses.push(response); return response; });
 const pending = readMarketingCalendars(fetcher), settled = pending.catch(error => ({ name: error.name, message: error.message }));
 await vi.waitFor(() => expect(responses).toHaveLength(2)); await vi.waitFor(() => expect(responses.every(response => response.body?.locked)).toBe(true));
 deadline.abort('TEST_ONLY_PRIVATE_REASON'); let observed: unknown;
 try { observed = await shortWait(settled); }
 finally { responses.forEach((response, index) => { if (response.body?.locked) streams[index].close(); }); await settled; }
 expect(observed).toMatchObject({ name: 'AbortError' }); expect(JSON.stringify(observed)).not.toContain('TEST_ONLY_PRIVATE');
 expect(clock.mock.calls.filter(([ms]) => ms === 20_000)).toHaveLength(1); expect(responses.every(response => !response.body?.locked)).toBe(true);
});

it('keeps invalid UTF-8 calendar data distinct from a GitHub availability failure', async () => {
 const result = await readMarketingCalendars(async () => new Response(new Uint8Array([255])), [MARKETING_CALENDAR_SOURCES[0]], '2026-10-29T00:00:00Z');
 expect(result.sources[0]).toMatchObject({ status: 'invalid-json', calendar: null, detail: null });
});
