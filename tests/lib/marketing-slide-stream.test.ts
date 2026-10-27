import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createDneskaiSlideStorage } from '@/lib/marketing/worker-runtime';
vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111', key = 'a'.repeat(64), bytes = Buffer.from('TEST_ONLY_CACHED_JPEG'), sha256 = createHash('sha256').update(bytes).digest('hex');
function fixture(body: () => Response | Promise<Response>, size = bytes.length, hooks: {
    upload?: () => Promise<Response>;
    info?: () => Promise<Response>;
} = {}) {
    const fetcher = vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/bucket/'))
            return Response.json({ id: 'marketing-assets', name: 'marketing-assets', public: false });
        if (url.includes('/object/info/'))
            return hooks.info ? hooks.info() : Response.json({ size, contentType: 'image/jpeg', metadata: { ownerId: owner, renderKey: key, sha256 } });
        if (url.includes('/object/sign/'))
            return Response.json({ signedURL: '/object/sign/marketing-assets/test?token=TEST_ONLY' });
        if (init?.method === 'POST')
            return hooks.upload ? hooks.upload() : Response.json({ Key: 'marketing-assets/test', Id: 'TEST_ONLY' });
        return body();
    });
    const db = createClient('https://slide-stream.supabase.co', 'TEST-ONLY-service', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } });
    return { db, fetcher };
}
afterEach(() => vi.restoreAllMocks());
it('reuses verified cache bytes without eager SDK Blob materialization', async () => {
    const response = new Response(bytes), blob = vi.spyOn(response, 'blob'), { db } = fixture(() => response);
    expect(await createDneskaiSlideStorage(db, owner).find(key)).toMatchObject({ sha256 });
    expect(blob).not.toHaveBeenCalled();
});
it('stops an oversized cache producer at its recorded size before consuming its tail', async () => {
    let pulls = 0;
    const cancel = vi.fn(), response = new Response(new ReadableStream<Uint8Array>({ pull(c) {
            if (++pulls <= 512)
                c.enqueue(new Uint8Array(65536));
            else
                c.close();
        }, cancel }, { highWaterMark: 0 })), { db, fetcher } = fixture(() => response, 1024 * 1024);
    await expect(createDneskaiSlideStorage(db, owner).find(key)).rejects.toHaveProperty('code', 'stored-asset-hash-mismatch');
    expect(pulls).toBeLessThanOrEqual(17);
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
    expect(fetcher.mock.calls.some(([u]) => String(u).includes('/object/sign/'))).toBe(false);
});
const input = { renderKey: key, bytes, sha256, metadata: {} };
async function access(db: ReturnType<typeof fixture>['db'], mode: 'find' | 'put', signal?: AbortSignal) {
    const storage = createDneskaiSlideStorage(db, owner, { signal });
    return mode === 'find' ? storage.find(key) : storage.put(input);
}
it('verifies an uploaded object through streaming bytes without eager conversion', async () => {
    const response = new Response(bytes), blob = vi.spyOn(response, 'blob'), { db } = fixture(() => response);
    expect(await access(db, 'put')).toMatchObject({ sha256 });
    expect(blob).not.toHaveBeenCalled();
});
it.each(['find', 'put'] as const)('refuses a truncated %s body before signing', async (mode) => {
    const { db, fetcher } = fixture(() => new Response(bytes.subarray(1)));
    await expect(access(db, mode)).rejects.toHaveProperty('code', 'stored-asset-hash-mismatch');
    expect(fetcher.mock.calls.some(([u]) => String(u).includes('/object/sign/'))).toBe(false);
});
it.each(['find', 'put'] as const)('settles a stalled %s body and observes cancellation without waiting for the producer', async (mode) => {
    const caller = new AbortController(), pull = vi.fn(), cancel = vi.fn(() => new Promise<void>(() => {
    })), response = new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 })), { db, fetcher } = fixture(() => response);
    const pending = access(db, mode, caller.signal).catch(error => error);
    await vi.waitFor(() => expect(pull).toHaveBeenCalledOnce());
    caller.abort('TEST_ONLY_PRIVATE_REASON');
    expect(await pending).toMatchObject({ code: 'worker-timeout', message: 'worker-timeout' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
    expect(fetcher.mock.calls.some(([u]) => String(u).includes('/object/sign/'))).toBe(false);
});
it.each(['find', 'put'] as const)('discards a late %s stream after its original owner lifetime retires', async (mode) => {
    const caller = new AbortController();
    let resolve!: (value: Response) => void;
    const body = vi.fn(() => new Promise<Response>(done => {
        resolve = done;
    })), { db, fetcher } = fixture(body);
    const pending = access(db, mode, caller.signal).catch(error => error);
    await vi.waitFor(() => expect(body).toHaveBeenCalledOnce());
    caller.abort('TEST_ONLY_PRIVATE_REASON');
    expect(await pending).toMatchObject({ code: 'worker-timeout' });
    const cancel = vi.fn();
    resolve(new Response(new ReadableStream({ cancel })));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(fetcher.mock.calls.some(([u]) => String(u).includes('/object/sign/'))).toBe(false);
});
it('starts no verification or signing after an upload returns to a retired owner', async () => {
    const caller = new AbortController(), info = vi.fn(async () => Response.json({})), { db, fetcher } = fixture(() => new Response(bytes), bytes.length, { upload: async () => {
            caller.abort('TEST_ONLY_PRIVATE_REASON');
            return Response.json({ Key: 'test' });
        }, info });
    await expect(access(db, 'put', caller.signal)).rejects.toMatchObject({ code: 'worker-timeout' });
    expect(info).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
});
it.each(['find', 'put'] as const)('contains an unavailable %s body without inventing absence or exposing private diagnostics', async (mode) => {
    const { db, fetcher } = fixture(() => Response.json({ message: 'TEST_ONLY_PRIVATE_STORAGE_DETAIL' }, { status: 503 }));
    await expect(access(db, mode)).rejects.toMatchObject({ code: 'asset-storage-failed', message: 'asset-storage-failed' });
    expect(fetcher.mock.calls.some(([u]) => String(u).includes('/object/sign/'))).toBe(false);
});
it.each(['find', 'put'] as const)('accepts the exact 8 MiB %s ceiling without eager materialization', async (mode) => {
    const exact = Buffer.alloc(8 * 1024 * 1024), digest = createHash('sha256').update(exact).digest('hex'), response = new Response(exact), blob = vi.spyOn(response, 'blob'), { db } = fixture(() => response, exact.length, { info: async () => Response.json({ size: exact.length, contentType: 'image/jpeg', metadata: { ownerId: owner, renderKey: key, sha256: digest } }) });
    const storage = createDneskaiSlideStorage(db, owner);
    expect(await (mode === 'find' ? storage.find(key) : storage.put({ renderKey: key, bytes: exact, sha256: digest, metadata: {} }))).toMatchObject({ sha256: digest });
    expect(blob).not.toHaveBeenCalled();
});
it('bounds an uncooperative upload and starts no later phase', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const upload = vi.fn(() => new Promise<Response>(() => {
    })), info = vi.fn(async () => Response.json({})), { db } = fixture(() => new Response(bytes), bytes.length, { upload, info });
    const pending = access(db, 'put').catch(error => error);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
    deadline.abort('TEST_ONLY_PRIVATE_REASON');
    expect(await pending).toMatchObject({ code: 'worker-timeout', message: 'worker-timeout' });
    expect(info).not.toHaveBeenCalled();
});
it('bounds a stalled bucket read before any upload starts', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const { db, fetcher } = fixture(() => new Response(bytes));
    fetcher.mockImplementationOnce(() => new Promise<Response>(() => {
    }));
    const pending = access(db, 'put').catch(error => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    deadline.abort('TEST_ONLY_PRIVATE_REASON');
    expect(await pending).toMatchObject({ code: 'worker-timeout' });
    expect(fetcher).toHaveBeenCalledOnce();
});
it('admits no request for empty or already retired writes', async () => {
    const { db, fetcher } = fixture(() => new Response(bytes)), caller = new AbortController();
    caller.abort('TEST_ONLY_PRIVATE_REASON');
    await expect(access(db, 'put', caller.signal)).rejects.toHaveProperty('code', 'worker-timeout');
    await expect(createDneskaiSlideStorage(db, owner).put({ ...input, bytes: Buffer.alloc(0), sha256: createHash('sha256').update('').digest('hex') })).rejects.toHaveProperty('code', 'asset-input-invalid');
    expect(fetcher).not.toHaveBeenCalled();
});
