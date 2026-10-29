import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { loadDneskaiSlideBytes } from '@/lib/marketing/dneskai-reel';
vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111', key = 'a'.repeat(64), bytes = Buffer.from('TEST_ONLY_JPEG_FIXTURE'), sha256 = createHash('sha256').update(bytes).digest('hex'), maximum = 8 * 1024 * 1024;
const info = () => ({ size: bytes.length, contentType: 'image/jpeg', metadata: { ownerId: owner, renderKey: key, sha256 } });
function client(metadata: unknown, body: () => Response) {
    const fetcher = vi.fn(async (url) => String(url).includes('/object/info/') ? Response.json(metadata) : body());
    return {
        db: createClient('https://reel-slide.supabase.co', 'TEST-ONLY-service', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } }), fetcher
    };
}
afterEach(() => vi.restoreAllMocks());
it.each([{ ...info(), size: maximum + 1 }, { ...info(), contentType: 'image/png' }, { ...info(), metadata: { ...info().metadata, renderKey: 'b'.repeat(64) } }])('refuses unsupported or mismatched file metadata before transfer: %#', async (metadata) => {
    const body = vi.fn(() => new Response(bytes)), { db } = client(metadata, body);
    expect(await loadDneskaiSlideBytes(db, owner, key).then(() => 'unexpected-success', error => error.code)).toBe('reel-slides-unavailable');
    expect(body).not.toHaveBeenCalled();
});
it('collects a verified slide as a stream without eager SDK Blob conversion', async () => {
    const response = new Response(bytes), blob = vi.spyOn(response, 'blob'), { db } = client(info(), () => response);
    expect(await loadDneskaiSlideBytes(db, owner, key)).toEqual(bytes);
    expect(blob).not.toHaveBeenCalled();
});
it.each([{ ...info(), size: 0 }, { ...info(), size: 1.5 }, { ...info(), size: null }, { ...info(), metadata: { ...info().metadata, ownerId: '22222222-2222-4222-8222-222222222222' } }, { ...info(), metadata: { ...info().metadata, sha256: 'bad' } }, { ...info(), metadata: { ownerId: owner, sha256 } }])('requires complete positive size/owner/key/checksum metadata: %#', async (metadata) => {
    const body = vi.fn(() => new Response(bytes)), { db } = client(metadata, body);
    await expect(loadDneskaiSlideBytes(db, owner, key)).rejects.toMatchObject({ code: 'reel-slides-unavailable', message: 'reel-slides-unavailable' });
    expect(body).not.toHaveBeenCalled();
});
it('accepts the exact 8 MiB ceiling without eager Blob materialization', async () => {
    const exact = Buffer.alloc(maximum), response = new Response(exact), blob = vi.spyOn(response, 'blob'), { db } = client({ ...info(), size: maximum, metadata: { ...info().metadata, sha256: createHash('sha256').update(exact).digest('hex') } }, () => response);
    expect((await loadDneskaiSlideBytes(db, owner, key)).length).toBe(maximum);
    expect(blob).not.toHaveBeenCalled();
});
it('stops an oversized producer at the positive declared size without consuming its tail', async () => {
    let pulls = 0;
    const cancel = vi.fn(), response = new Response(new ReadableStream<Uint8Array>({ pull(controller) {
            if (++pulls <= 512)
                controller.enqueue(new Uint8Array(65536));
            else
                controller.close();
        }, cancel }, { highWaterMark: 0 })), { db } = client({ ...info(), size: 1024 * 1024 }, () => response);
    await expect(loadDneskaiSlideBytes(db, owner, key)).rejects.toHaveProperty('code', 'reel-slides-unavailable');
    expect(pulls).toBeLessThanOrEqual(17);
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
});
it.each([new Uint8Array(), new Uint8Array(bytes.length - 1), new Uint8Array(bytes.length)])('refuses empty, truncated or checksum-mismatched bytes: %#', async (value) => {
    const { db } = client(info(), () => new Response(value));
    await expect(loadDneskaiSlideBytes(db, owner, key)).rejects.toMatchObject({ code: 'reel-slides-unavailable', message: 'reel-slides-unavailable' });
});
it('bounds a stalled metadata request and starts no later file read', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const fetcher = vi.fn(() => new Promise<Response>(() => {
    })), db = createClient('https://reel-slide.supabase.co', 'TEST-ONLY-service', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } });
    const pending = loadDneskaiSlideBytes(db, owner, key).catch(error => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    deadline.abort('TEST_ONLY_PRIVATE_REASON');
    expect(await pending).toMatchObject({ code: 'reel-slides-unavailable', message: 'reel-slides-unavailable' });
    expect(fetcher).toHaveBeenCalledOnce();
});
it('settles a stalled body without awaiting producer cancellation', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const pull = vi.fn(), cancel = vi.fn(() => new Promise<void>(() => {
    })), response = new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 })), { db } = client(info(), () => response);
    const pending = loadDneskaiSlideBytes(db, owner, key).catch(error => error);
    await vi.waitFor(() => expect(pull).toHaveBeenCalledOnce());
    deadline.abort('TEST_ONLY_PRIVATE_REASON');
    expect(await pending).toMatchObject({ code: 'reel-slides-unavailable', message: 'reel-slides-unavailable' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
});
it('discards a late successful file body after original cancellation', async () => {
    const caller = new AbortController();
    let resolve!: (value: Response) => void;
    const body = vi.fn(() => new Promise<Response>(done => {
        resolve = done;
    })), fetcher = vi.fn(async (url) => String(url).includes('/object/info/') ? Response.json(info()) : body()), db = createClient('https://reel-slide.supabase.co', 'TEST-ONLY-service', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } });
    const pending = loadDneskaiSlideBytes(db, owner, key, caller.signal).catch(error => error);
    await vi.waitFor(() => expect(body).toHaveBeenCalledOnce());
    caller.abort('TEST_ONLY_PRIVATE_REASON');
    expect(await pending).toMatchObject({ name: 'AbortError', message: 'Request aborted' });
    const cancel = vi.fn();
    resolve(new Response(new ReadableStream({ cancel })));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
});
it('starts no storage request for invalid or retired original selectors', async () => {
    const body = vi.fn(), { db, fetcher } = client(info(), body), caller = new AbortController();
    caller.abort('TEST_ONLY_PRIVATE_REASON');
    await expect(loadDneskaiSlideBytes(db, owner, key, caller.signal)).rejects.toMatchObject({ name: 'AbortError', message: 'Request aborted' });
    await expect(loadDneskaiSlideBytes(db, owner, 'bad')).rejects.toHaveProperty('code', 'reel-slides-unavailable');
    await expect(loadDneskaiSlideBytes(db, 'bad', key)).rejects.toHaveProperty('code', 'reel-slides-unavailable');
    expect(fetcher).not.toHaveBeenCalled();
});
it('contains producer failures without exposing private diagnostics', async () => {
    const { db } = client(info(), () => new Response(new ReadableStream({ pull(controller) {
            controller.error(new Error('TEST_ONLY_PRIVATE_STREAM_DETAIL'));
        } })));
    await expect(loadDneskaiSlideBytes(db, owner, key)).rejects.toMatchObject({ code: 'reel-slides-unavailable', message: 'reel-slides-unavailable' });
});
it('rejects a typed storage refusal without inventing missing slides or retrying', async () => {
    const { db, fetcher } = client(info(), () => Response.json({ message: 'TEST_ONLY_PRIVATE_DETAIL' }, { status: 503 }));
    await expect(loadDneskaiSlideBytes(db, owner, key)).rejects.toMatchObject({ code: 'reel-slides-unavailable', message: 'reel-slides-unavailable' });
    expect(fetcher).toHaveBeenCalledTimes(2);
});
