import { afterEach, expect, it, vi } from 'vitest';
import { selectDeadUrls } from '@/lib/jobs/prune';
const url = 'https://jobs.cz/rpd/synthetic-offer';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('bounds a stalled batch and excludes its late closure receipt', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
 let finish!: (status: number | null) => void, settled = false;
 const probe = vi.fn(() => new Promise<number | null>(resolve => { finish = resolve; }));
 const pending = selectDeadUrls([url], { budgetMs: 10, probe }).then(result => { settled = true; return result; });
 await vi.advanceTimersByTimeAsync(0); expect(probe).toHaveBeenCalledOnce(); await vi.advanceTimersByTimeAsync(11); const bounded = settled;
 finish(404); const result = await pending;
 expect(bounded).toBe(true); expect([...result]).toEqual([]); expect(probe).toHaveBeenCalledOnce();
});
it('releases both HEAD and GET bodies while preserving explicit fallback closure evidence', async () => {
 const headCancel = vi.fn(), getCancel = vi.fn();
 const fetcher = vi.fn().mockResolvedValueOnce(new Response(new ReadableStream({ cancel: headCancel }), { status: 405 })).mockResolvedValueOnce(new Response(new ReadableStream({ cancel: getCancel }), { status: 410 }));
 vi.stubGlobal('fetch', fetcher);
 expect([...await selectDeadUrls([url])]).toEqual([url]);
 expect(headCancel).toHaveBeenCalledOnce(); expect(getCancel).toHaveBeenCalledOnce();
 expect(fetcher.mock.calls.map(([, init]) => init.method)).toEqual(['HEAD', 'GET']);
 expect(fetcher.mock.calls.every(([, init]) => init.redirect === 'manual' && init.signal.aborted)).toBe(true);
});
it('cancels an HTTP response arriving after the total deadline and does not send GET', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
 let finish!: (response: Response) => void; const cancel = vi.fn();
 const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal('fetch', fetcher);
 const pending = selectDeadUrls([url], { budgetMs: 10 });
 await vi.advanceTimersByTimeAsync(0); expect(fetcher).toHaveBeenCalledOnce(); await vi.advanceTimersByTimeAsync(11);
 expect([...await pending]).toEqual([]); finish(new Response(new ReadableStream({ cancel }), { status: 405 })); await vi.advanceTimersByTimeAsync(0);
 expect(cancel).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce();
});
it('carries the remaining total budget through HEAD and GET without granting another eight seconds', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
 let finish!: (response: Response) => void, settled = false;
 const fetcher = vi.fn().mockImplementationOnce(async () => { await new Promise(resolve => setTimeout(resolve, 6)); return new Response(null, { status: 405 }); }).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal('fetch', fetcher);
 const pending = selectDeadUrls([url], { budgetMs: 10 }).then(result => { settled = true; return result; });
 await vi.advanceTimersByTimeAsync(7); expect(fetcher).toHaveBeenCalledTimes(2); await vi.advanceTimersByTimeAsync(4); const bounded = settled;
 finish(new Response(null, { status: 404 })); expect([...await pending]).toEqual([]); expect(bounded).toBe(true);
});
it('keeps earlier timely proof while discarding a later stalled batch', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
 const second = `${url}-second`; let finish!: (status: number) => void;
 const probe = vi.fn().mockResolvedValueOnce(404).mockImplementationOnce(() => new Promise<number>(resolve => { finish = resolve; }));
 const pending = selectDeadUrls([url, second], { batchSize: 1, budgetMs: 10, probe });
 await vi.advanceTimersByTimeAsync(0); expect(probe).toHaveBeenCalledTimes(2); await vi.advanceTimersByTimeAsync(11);
 const result = await pending; expect([...result]).toEqual([url]); finish(410); await vi.advanceTimersByTimeAsync(0); expect([...result]).toEqual([url]);
});
it('treats a failed custom probe as unknown rather than discarding other definite results', async () => {
 const probe = vi.fn().mockRejectedValueOnce(Error('synthetic-private-provider-detail')).mockResolvedValueOnce(404);
 expect([...await selectDeadUrls([url, `${url}-second`], { probe })]).toEqual([`${url}-second`]);
});
it('deduplicates only the bounded admission slice', async () => {
 const probe = vi.fn().mockResolvedValue(404);
 expect([...await selectDeadUrls([url, url, `${url}-second`, `${url}-third`], { maxChecks: 3, probe })]).toEqual([url, `${url}-second`]); expect(probe).toHaveBeenCalledTimes(2);
});
it.each([200, 301, 302, 403, 429, 500, 503])('retains a listing on HEAD status %s and releases its unused body', async status => {
 const cancel = vi.fn(), fetcher = vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), { status })); vi.stubGlobal('fetch', fetcher);
 expect([...await selectDeadUrls([url])]).toEqual([]); expect(cancel).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce();
});
it('does not probe an unregistered host, credentials, custom ports or plain HTTP', async () => {
 const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
 expect([...await selectDeadUrls(['https://unregistered.example.test/job', 'https://synthetic:synthetic@jobs.cz/job', 'https://jobs.cz:8443/job', 'http://jobs.cz/job'])]).toEqual([]); expect(fetcher).not.toHaveBeenCalled();
});
it('stops an already cancelled caller before transport with a fixed error', async () => {
 const parent = new AbortController(), probe = vi.fn(); parent.abort('synthetic-private-abort');
 await expect(selectDeadUrls([url], { signal: parent.signal, probe })).rejects.toThrow(/^Request aborted$/); expect(probe).not.toHaveBeenCalled();
});
it('retires an uncooperative custom probe on caller cancellation and ignores the late result', async () => {
 let finish!: (status: number) => void; const parent = new AbortController();
 const probe = vi.fn(() => new Promise<number>(resolve => { finish = resolve; }));
 const pending = selectDeadUrls([url], { signal: parent.signal, probe }).catch(error => error);
 await vi.waitFor(() => expect(probe).toHaveBeenCalledOnce()); parent.abort('synthetic-private-abort');
 expect(await pending).toMatchObject({ name: 'AbortError', message: 'Request aborted' }); finish(404); await Promise.resolve(); expect(probe).toHaveBeenCalledOnce();
});
it.each([
 { batchSize: 0 }, { batchSize: -1 }, { batchSize: 11 }, { batchSize: Number.NaN }, { maxChecks: -1 }, { maxChecks: 1.5 }, { maxChecks: 151 }, { maxChecks: Number.POSITIVE_INFINITY },
 { budgetMs: 0 }, { budgetMs: -1 }, { budgetMs: Number.NaN }, { budgetMs: Number.POSITIVE_INFINITY }, { budgetMs: 15001 },
])('performs no work for unsafe internal bounds (%j)', async options => {
 const probe = vi.fn(); expect([...await selectDeadUrls([url], { ...options, probe })]).toEqual([]); expect(probe).not.toHaveBeenCalled();
});
it('refuses an invalid or regressing observation clock before using late evidence', async () => {
 const probe = vi.fn().mockResolvedValue(404);
 expect([...await selectDeadUrls([url], { now: () => Number.NaN, probe })]).toEqual([]);
 let clock = 100;
 expect([...await selectDeadUrls([url], { now: () => clock--, probe })]).toEqual([]); expect(probe).not.toHaveBeenCalled();
});
