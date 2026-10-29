import { expect, it, vi } from 'vitest';
import { boundedRequestText } from '@/lib/marketing/http';
import { readKnowledgeBody } from '@/lib/marketing/knowledge-body';
vi.mock('server-only', () => ({}));
const request = (body: ReadableStream<Uint8Array>) => new Request('https://request-snapshot.invalid', { method: 'POST', body, duplex: 'half' } as RequestInit);
const readers = [{ name: 'marketing', read: boundedRequestText, error: { code: 'invalid-body', message: 'invalid-body' } }, { name: 'knowledge', read: readKnowledgeBody, error: { message: 'capture-read-failed' } }];
it.each(readers)('$name bounds empty request chunks independently of the byte ceiling', async ({ read, error }) => {
    let pulls = 0;
    const cancel = vi.fn(), body = new ReadableStream<Uint8Array>({ pull(c) {
            if (++pulls <= 70000)
                c.enqueue(new Uint8Array());
            else
                c.close();
        }, cancel }, { highWaterMark: 0 });
    await expect(read(request(body), 1000)).rejects.toMatchObject(error);
    expect(pulls).toBeLessThanOrEqual(65538);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
});
it.each(readers)('$name retains an owned immutable snapshot when a producer reuses a Buffer', async ({ read }) => {
    const bytes = Buffer.from('AB');
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({ pull(c) {
            if (++pulls === 1)
                c.enqueue(bytes);
            else {
                bytes.fill('Z');
                c.close();
            }
        } }, { highWaterMark: 0 });
    expect(await read(request(body), 2)).toBe('AB');
});
it.each(readers)('$name accepts the exact chunk-count ceiling', async ({ read }) => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({ pull(c) {
            if (++pulls <= 65536)
                c.enqueue(new Uint8Array([65]));
            else
                c.close();
        } }, { highWaterMark: 0 });
    expect(await read(request(body), 65536)).toBe('A'.repeat(65536));
    expect(body.locked).toBe(false);
});
it.each(readers)('$name refuses a stream held by another reader without taking its lock', async ({ read, error }) => {
    const body = new ReadableStream<Uint8Array>(), input = request(body), reader = body.getReader();
    await expect(read(input, 100)).rejects.toMatchObject(error);
    expect(body.locked).toBe(true);
    reader.releaseLock();
});
it.each(readers)('$name refuses already consumed input with a fixed failure', async ({ read, error }) => {
    const input = new Request('https://request-snapshot.invalid', { method: 'POST', body: 'AB' });
    await input.text();
    await expect(read(input, 100)).rejects.toMatchObject(error);
});
it.each(readers)('$name keeps malformed UTF-8 failures fixed and releases the stream', async ({ read, error }) => {
    const body = new ReadableStream<Uint8Array>({ start(c) {
            c.enqueue(new Uint8Array([0xc3]));
            c.close();
        } });
    await expect(read(request(body), 100)).rejects.toMatchObject(error);
    expect(body.locked).toBe(false);
});
