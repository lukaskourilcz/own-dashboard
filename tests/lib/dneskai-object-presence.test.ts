import { createClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
import { readDneskaiCacheObjectPresence } from '@/lib/marketing/dneskai-object-presence';
vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222', key = 'a'.repeat(64), receipt = () => ({ ownerId: owner, kind: 'reel', key, state: 'absent' });
const db = (fetcher: typeof fetch) => createClient('https://object-proof.supabase.co', 'TEST-ONLY-service', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } });
afterEach(() => vi.restoreAllMocks());
it.each(['present', 'absent'] as const)('requires the exact positive %s receipt in one bounded RPC', async (state) => {
    let path!: URL, body!: unknown;
    const fetcher = vi.fn(async (url, init) => {
        path = new URL(String(url));
        body = JSON.parse(String(init?.body));
        return Response.json({ ...receipt(), state });
    });
    expect(await readDneskaiCacheObjectPresence(db(fetcher), owner, 'reel', key)).toBe(state);
    expect(path.pathname).toBe('/rest/v1/rpc/read_owned_dneskai_cache_object');
    expect(body).toEqual({ p_owner: owner, p_kind: 'reel', p_key: key });
    expect(fetcher).toHaveBeenCalledOnce();
});
it.each([null, [], { ...receipt(), ownerId: other }, { ...receipt(), kind: 'slide' }, { ...receipt(), key: 'b'.repeat(64) }, { ...receipt(), state: 'missing' }, { ...receipt(), state: null }, { ...receipt(), extra: true }].map(value => ({ value })))('refuses incomplete, foreign or unknown absence data: %#', async ({ value }) => {
    const fetcher = vi.fn(async () => Response.json(value));
    await expect(readDneskaiCacheObjectPresence(db(fetcher), owner, 'reel', key)).rejects.toThrow('Cache object unavailable');
    expect(fetcher).toHaveBeenCalledOnce();
});
it('does not retry failed presence proof or expose its private error', async () => {
    const fetcher = vi.fn(async () => Response.json({ message: 'TEST_ONLY_PRIVATE_DETAIL' }, { status: 503 }));
    await expect(readDneskaiCacheObjectPresence(db(fetcher), owner, 'reel', key)).rejects.toThrow(/^Cache object unavailable$/);
    expect(fetcher).toHaveBeenCalledOnce();
});
it('settles a stalled proof without claiming absence', async () => {
    const stop = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(stop.signal);
    const fetcher = vi.fn(() => new Promise<Response>(() => {
    })), pending = readDneskaiCacheObjectPresence(db(fetcher), owner, 'reel', key).catch(error => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    stop.abort('TEST_ONLY_PRIVATE_REASON');
    expect(await pending).toMatchObject({ message: 'Cache object unavailable' });
    expect(fetcher).toHaveBeenCalledOnce();
});
it('starts no probe after invalid selectors or original retirement', async () => {
    const fetcher = vi.fn(), stop = new AbortController();
    stop.abort('TEST_ONLY_PRIVATE_REASON');
    await expect(readDneskaiCacheObjectPresence(db(fetcher), owner, 'reel', key, stop.signal)).rejects.toMatchObject({ name: 'AbortError', message: 'Request aborted' });
    await expect(readDneskaiCacheObjectPresence(db(fetcher), 'bad', 'reel', key)).rejects.toThrow('Cache object unavailable');
    await expect(readDneskaiCacheObjectPresence(db(fetcher), owner, 'other' as never, key)).rejects.toThrow('Cache object unavailable');
    await expect(readDneskaiCacheObjectPresence(db(fetcher), owner, 'reel', 'bad')).rejects.toThrow('Cache object unavailable');
    expect(fetcher).not.toHaveBeenCalled();
});
