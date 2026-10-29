import { afterEach, expect, it, vi } from 'vitest';
import { fetchDataExport } from '@/lib/data-export-download';
import { EXPORT_MAX_BYTES } from '@/lib/data-export-limits';
const owner = '11111111-1111-4111-8111-111111111111';
const headers = { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="owndashboard-notes-2026-10-25.json"' };
const scope = () => new AbortController();
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('captures owner, route and private request options and preserves downloaded bytes', async () => {
 const wire = vi.fn<typeof fetch>(async () => new Response('{"synthetic":"=raw JSON"}', { headers }));
 const result = await fetchDataExport(owner, 'notes', scope().signal, wire);
 expect(result.name).toBe('owndashboard-notes-2026-10-25.json'); expect(await result.blob.text()).toBe('{"synthetic":"=raw JSON"}');
 expect(wire).toHaveBeenCalledOnce(); expect(wire.mock.calls[0][0]).toBe('/api/export/notes');
 expect(wire.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'x-export-owner': owner } });
});
it('uses only the financial transactions CSV route', async () => {
 const wire = vi.fn<typeof fetch>(async () => new Response('"id"\r\n"synthetic"', { headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="owndashboard-transactions-2026-10-25.csv"' } }));
 const result = await fetchDataExport(owner, 'transactions-csv', scope().signal, wire);
 expect(wire.mock.calls[0][0]).toBe('/api/export/financial?format=csv&table=transactions'); expect(await result.blob.text()).toBe('"id"\r\n"synthetic"');
});
it.each([[401, 'account'], [409, 'account'], [413, 'too-large'], [500, 'unavailable']])('classifies safe status %s without exposing the response body', async (status, reason) => {
 await expect(fetchDataExport(owner, 'notes', scope().signal, async () => new Response('PRIVATE TEST diagnostic', { status: Number(status) }))).rejects.toMatchObject({ reason, message: 'Download unavailable' });
});
it.each([
 { 'content-type': 'text/html' }, { 'content-disposition': 'inline' },
 { 'content-disposition': 'attachment; filename="../../private.json"' },
 { 'content-disposition': 'attachment; filename="owndashboard-full-2026-10-25.json"' },
 { 'content-disposition': 'attachment; filename="owndashboard-notes-2026-10-25.csv"' },
])('rejects a login page or unexpected download metadata %j', async override => {
 await expect(fetchDataExport(owner, 'notes', scope().signal, async () => new Response('synthetic', { headers: { ...headers, ...override } }))).rejects.toMatchObject({ reason: 'unavailable' });
});
it('refuses an oversized announced file before consuming its body', async () => {
 let pulls = 0;
 const stream = new ReadableStream({ pull() { pulls++; } }, { highWaterMark: 0 });
 await expect(fetchDataExport(owner, 'notes', scope().signal, async () => new Response(stream, { headers: { ...headers, 'content-length': String(EXPORT_MAX_BYTES + 1) } }))).rejects.toMatchObject({ reason: 'too-large' }); expect(pulls).toBe(0);
});
it('counts stream bytes without trusting a smaller announced length and cancels overflow', async () => {
 const cancel = vi.fn(), chunks = [new Uint8Array(EXPORT_MAX_BYTES), new Uint8Array(1)];
 const stream = new ReadableStream({ pull(controller) { if (chunks.length) controller.enqueue(chunks.shift()!); else controller.close(); }, cancel }, { highWaterMark: 0 });
 await expect(fetchDataExport(owner, 'notes', scope().signal, async () => new Response(stream, { headers: { ...headers, 'content-length': '1' } }))).rejects.toMatchObject({ reason: 'too-large' }); expect(cancel).toHaveBeenCalledOnce();
});
it('does not accept an empty success body as a saved file', async () => {
 await expect(fetchDataExport(owner, 'notes', scope().signal, async () => new Response('', { headers }))).rejects.toMatchObject({ reason: 'unavailable' });
});
it('cancels a pending body read and observes its late result', async () => {
 const controller = scope(); let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; }); const cancel = vi.fn();
 const stream = new ReadableStream({ pull() { started(); return new Promise(() => {}); }, cancel }, { highWaterMark: 0 });
 const pending = fetchDataExport(owner, 'notes', controller.signal, async () => new Response(stream, { headers })); await ready; controller.abort();
 await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(cancel).toHaveBeenCalledOnce();
});
it('bounds an uncooperative transport to forty seconds', async () => {
 vi.useFakeTimers(); vi.spyOn(AbortSignal, 'timeout').mockImplementation(delay => { const controller = scope(); setTimeout(() => controller.abort(), delay); return controller.signal; });
 const pending = fetchDataExport(owner, 'notes', scope().signal, () => new Promise(() => {})); const check = expect(pending).rejects.toMatchObject({ reason: 'unavailable' }); await vi.advanceTimersByTimeAsync(40001); await check;
});
