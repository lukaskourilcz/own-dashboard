import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { readFullMarketingCalendar } from '@/lib/marketing/calendar-source';
const commit = 'a'.repeat(40), limit = 1024 * 1024;
const plan = () => ({ schemaVersion: 'marketing-calendar/1', project: 'devshark', entries: [{ body: 'Authored original copy', assets: ['logo.svg'] }], prelaunch: [{ status: 'done' }] });
const sourceFetcher = (value = plan()) => vi.fn(async (path: string) => path.includes('/commits?') ? Response.json([{ sha: commit }]) : new Response(JSON.stringify(value)));
afterEach(() => vi.restoreAllMocks());
it('reads full immutable commit content without dropping fields and hashes the original bytes', async () => {
 const original = plan(), raw = JSON.stringify(original), fetcher = sourceFetcher(original);
 const result = await readFullMarketingCalendar(fetcher, 'devshark');
 expect(result.entries).toEqual(original.entries); expect(result.prelaunch).toEqual(original.prelaunch);
 expect(result._importProvenance.sourceCommit).toBe(commit);
 expect(result._importProvenance.fileSha256).toBe(createHash('sha256').update(raw).digest('hex'));
 expect(fetcher.mock.calls[1][0]).toContain(`?ref=${commit}`);
});
it('rejects unavailable repositories instead of importing an empty plan', async () => {
 await expect(readFullMarketingCalendar(async () => new Response(null, { status: 401 }), 'dneskai')).rejects.toThrow('calendar-repository-unavailable');
});
it('rejects a different project in the pinned file rather than importing another brand', async () => {
 const fetcher = sourceFetcher({ ...plan(), project: 'dneskai' });
 await expect(readFullMarketingCalendar(fetcher, 'devshark')).rejects.toThrow('calendar-source-unavailable');
});
it('starts no read for a retired original caller', async () => {
 const parent = new AbortController(); parent.abort('TEST_ONLY_PRIVATE_REASON'); const fetcher = sourceFetcher();
 await expect(readFullMarketingCalendar(fetcher, 'devshark', parent.signal)).rejects.toMatchObject({ name: 'AbortError' });
 expect(fetcher).not.toHaveBeenCalled();
});
it('does not read the file after retirement while commit headers are pending', async () => {
 let finish!: (response: Response) => void;
 const fetcher = sourceFetcher(); fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
 const parent = new AbortController(), pending = readFullMarketingCalendar(fetcher, 'devshark', parent.signal);
 await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce()); parent.abort('TEST_ONLY_PRIVATE_REASON'); finish(Response.json([{ sha: commit }]));
 await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(fetcher).toHaveBeenCalledOnce();
});
it('refuses an actually oversized commit response before requesting a file', async () => {
 const fetcher = sourceFetcher(); fetcher.mockResolvedValueOnce(Response.json([{ sha: commit, padding: 'x'.repeat(limit) }]));
 await expect(readFullMarketingCalendar(fetcher, 'devshark')).rejects.toThrow('calendar-repository-unavailable');
 expect(fetcher).toHaveBeenCalledOnce();
});
it('does not replace malformed UTF-8 in authored content with different characters', async () => {
 const raw = Buffer.concat([Buffer.from('{"schemaVersion":"marketing-calendar/1","project":"devshark","entries":[],"note":"'), Buffer.from([255]), Buffer.from('"}')]);
 const fetcher = sourceFetcher(); fetcher.mockResolvedValueOnce(Response.json([{ sha: commit }])).mockResolvedValueOnce(new Response(raw));
 await expect(readFullMarketingCalendar(fetcher, 'devshark')).rejects.toThrow('calendar-source-unavailable');
});
it('releases both successful response readers', async () => {
 const headers = Response.json([{ sha: commit }]), file = new Response(JSON.stringify(plan()));
 const fetcher = sourceFetcher(); fetcher.mockResolvedValueOnce(headers).mockResolvedValueOnce(file);
 await readFullMarketingCalendar(fetcher, 'devshark');
 expect(headers.body!.locked).toBe(false); expect(file.body!.locked).toBe(false);
});
it('discards a refused response without reading its diagnostics', async () => {
 const cancel = vi.fn(), refused = new Response(new ReadableStream({ cancel }), { status: 503 });
 const fetcher = sourceFetcher(); fetcher.mockResolvedValueOnce(refused);
 await expect(readFullMarketingCalendar(fetcher, 'devshark')).rejects.toThrow('calendar-repository-unavailable');
 expect(cancel).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce();
});
it('refuses excessive file bytes without waiting for an uncooperative cancellation hook', async () => {
 let release!: () => void;
 const cancel = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
 const file = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(limit + 1)); }, cancel }));
 const fetcher = sourceFetcher(); fetcher.mockResolvedValueOnce(Response.json([{ sha: commit }])).mockResolvedValueOnce(file);
 let settled = false;
 const pending = readFullMarketingCalendar(fetcher, 'devshark').then(value => { settled = true; return value; }, error => { settled = true; return error as Error; });
 try {
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(settled).toBe(true));
  expect(await pending).toMatchObject({ message: 'calendar-too-large' }); expect(file.body!.locked).toBe(false);
 } finally { release?.(); await pending; }
});

it('keeps an exact one-MiB complete file and its hash', async () => {
 const value = { ...plan(), padding: '' }, overhead = Buffer.byteLength(JSON.stringify(value));
 value.padding = 'x'.repeat(limit - overhead); const raw = JSON.stringify(value); expect(Buffer.byteLength(raw)).toBe(limit);
 const fetcher = sourceFetcher(value), result = await readFullMarketingCalendar(fetcher, 'devshark');
 expect(result.padding).toBe(value.padding); expect(result._importProvenance.fileSha256).toBe(createHash('sha256').update(raw).digest('hex'));
});
it('preserves an immutable snapshot when a producer reuses its previous chunk', async () => {
 const value = { ...plan(), note: 'Original' }, encoded = Buffer.from(JSON.stringify(value)), first = encoded.subarray(0, encoded.length - 1), second = encoded.subarray(encoded.length - 1);
 const offset = first.indexOf('Original'); let part = 0;
 const body = new ReadableStream<Uint8Array>({ pull(controller) {
  if (part++ === 0) controller.enqueue(first);
  else { first.set(Buffer.from('Modified'), offset); controller.enqueue(second); controller.close(); }
 } }, { highWaterMark: 0 });
 const fetcher = sourceFetcher(); fetcher.mockResolvedValueOnce(Response.json([{ sha: commit }])).mockResolvedValueOnce(new Response(body));
 const result = await readFullMarketingCalendar(fetcher, 'devshark');
 expect(result.note).toBe('Original'); expect(result._importProvenance.fileSha256).toBe(createHash('sha256').update(JSON.stringify(value)).digest('hex'));
});
it('shares one original twenty-second allowance across both ten-second phases', async () => {
 const timeout = vi.spyOn(AbortSignal, 'timeout');
 await readFullMarketingCalendar(sourceFetcher(), 'devshark');
 expect(timeout.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([20_000, 10_000, 10_000]);
});
it.each([201, 206])('refuses HTTP %i rather than treating a non-complete response as the commit', async status => {
 const fetcher = sourceFetcher(); fetcher.mockResolvedValueOnce(Response.json([{ sha: commit }], { status }));
 await expect(readFullMarketingCalendar(fetcher, 'devshark')).rejects.toThrow('calendar-repository-unavailable'); expect(fetcher).toHaveBeenCalledOnce();
});
