import { afterEach, expect, it, vi } from 'vitest';
import { boundedRequestText, MARKETING_BODY_TIMEOUT_MS } from '@/lib/marketing/http';
import { readBoundedMarketingJobBody } from '@/lib/marketing/worker-runtime';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
afterEach(() => vi.useRealTimers());
const bytes = (text: string) => new TextEncoder().encode(text);
const request = (body: ReadableStream<Uint8Array>, signal?: AbortSignal) => new Request('https://fixture.invalid', { method: 'POST', body, signal, duplex: 'half' } as RequestInit);

it('keeps exact signed UTF-8 bytes across chunks, including a BOM and whitespace', async () => {
 const text = '\uFEFF {"text":"Český text 🧪"}\n';
 const data = bytes(text);
 const req = request(new ReadableStream({ start(c) { for (const byte of data) c.enqueue(new Uint8Array([byte])); c.close(); } }));
 expect(await boundedRequestText(req, data.length)).toBe(text);
 expect(req.body?.locked).toBe(false);
});

it('refuses one byte over the bound without waiting for cancellation to finish', async () => {
 const cancel = vi.fn(() => new Promise<void>(() => {}));
 const req = request(new ReadableStream({ start(c) { c.enqueue(bytes('123456')); }, cancel }));
 await expect(boundedRequestText(req, 5)).rejects.toMatchObject({ code: 'payload-too-large' });
 expect(cancel).toHaveBeenCalledOnce(); expect(req.body?.locked).toBe(false);
});

it('stops a stalled upload after the whole-body budget, even if its cancel hook stalls', async () => {
 vi.useFakeTimers(); const cancel = vi.fn(() => new Promise<void>(() => {}));
 const req = request(new ReadableStream({ cancel }));
 const failed = expect(boundedRequestText(req)).rejects.toMatchObject({ code: 'request-body-timeout' });
 await vi.advanceTimersByTimeAsync(MARKETING_BODY_TIMEOUT_MS); await failed;
 expect(cancel).toHaveBeenCalledOnce(); expect(req.body?.locked).toBe(false); expect(vi.getTimerCount()).toBe(0);
});

it('does not reset the upload budget when another chunk arrives', async () => {
 vi.useFakeTimers(); let controller!: ReadableStreamDefaultController<Uint8Array>;
 const req = request(new ReadableStream({ start(c) { controller = c; } }));
 const failed = expect(boundedRequestText(req)).rejects.toMatchObject({ code: 'request-body-timeout' });
 await vi.advanceTimersByTimeAsync(MARKETING_BODY_TIMEOUT_MS - 1); controller.enqueue(bytes('{'));
 await vi.advanceTimersByTimeAsync(1); await failed; expect(req.body?.locked).toBe(false);
});

it('cancels on caller disconnect without exposing its reason', async () => {
 vi.useFakeTimers(); const controller = new AbortController(), cancel = vi.fn();
 const req = request(new ReadableStream({ cancel }), controller.signal);
 const failed = expect(boundedRequestText(req)).rejects.toMatchObject({ message: 'request-body-aborted' });
 controller.abort('synthetic private reason'); await failed;
 expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it('refuses an already cancelled request before locking or consuming its body', async () => {
 const controller = new AbortController(); controller.abort(); const req = request(new ReadableStream(), controller.signal);
 await expect(boundedRequestText(req)).rejects.toMatchObject({ code: 'request-body-aborted' });
 expect(req.bodyUsed).toBe(false); expect(req.body?.locked).toBe(false);
});

it('rejects malformed UTF-8 and hides stream errors', async () => {
 const malformed = request(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([0xc3])); c.close(); } }));
 await expect(boundedRequestText(malformed)).rejects.toMatchObject({ message: 'invalid-body' });
 const broken = request(new ReadableStream({ pull(c) { c.error(new Error('synthetic private producer error')); } }));
 await expect(boundedRequestText(broken)).rejects.toMatchObject({ message: 'invalid-body' });
 expect(broken.body?.locked).toBe(false);
});

it('keeps empty-body contracts and refuses invalid size configuration', async () => {
 const req = new Request('https://fixture.invalid');
 await expect(boundedRequestText(req)).rejects.toMatchObject({ code: 'missing-body' });
 expect(await readBoundedMarketingJobBody(req)).toBe('');
 for (const maximum of [0, -1, 1.5, Infinity]) await expect(boundedRequestText(req, maximum)).rejects.toMatchObject({ code: 'invalid-body' });
 expect(await boundedRequestText(new Request('https://fixture.invalid', { method:'POST',body:'' }))).toBe('');
});

it('applies the same deadline and stable error class to worker admission', async () => {
 vi.useFakeTimers(); const cancel = vi.fn();
 const failed = expect(readBoundedMarketingJobBody(request(new ReadableStream({ cancel })))).rejects.toMatchObject({ name:'MarketingWorkerRuntimeError',code:'request-body-timeout' });
 await vi.advanceTimersByTimeAsync(MARKETING_BODY_TIMEOUT_MS); await failed; expect(cancel).toHaveBeenCalledOnce();
});
