import { createClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
import { findDneskaiReelForRevision } from '@/lib/marketing/dneskai-reel';
vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111', revision = '22222222-2222-4222-8222-222222222222', other = '33333333-3333-4333-8333-333333333333', event = '44444444-4444-4444-8444-444444444444', hash = 'b'.repeat(64), key = 'a'.repeat(64), digest = 'c'.repeat(64);
const row = () => ({
    id: event, user_id: owner, revision_id: revision, kind: 'dneskai-reel-rendered', created_at: '2026-10-27T10:00:00.000001Z', reelKey: key, revisionHash: hash, audioId: null, sha256: digest, bytes: 1000
});
const receipt = () => ({ reelKey: key, url: 'https://test-only.supabase.co/reel.mp4', sha256: digest, bytes: 1000 });
const db = (fetcher: typeof fetch) => createClient('https://reel-lookup.supabase.co', 'TEST-ONLY-service', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } });
afterEach(() => vi.restoreAllMocks());
it('requires positive matching owned metadata and exact stored bytes before returning a Reel', async () => {
    let query!: URL;
    const fetcher = vi.fn(async (url) => {
        query = new URL(String(url));
        return Response.json([row()]);
    }), storage = { find: vi.fn(async () => receipt()), put: vi.fn() };
    expect(await findDneskaiReelForRevision(db(fetcher), owner, revision, hash, storage)).toEqual({ ...receipt(), audioId: null });
    expect(query.searchParams.get('payload->>revisionHash')).toBe('eq.' + hash);
    expect(query.searchParams.get('limit')).toBe('1');
    expect(query.searchParams.get('order')).toBe('created_at.desc,id.desc');
    expect(query.searchParams.get('select')!.split(',')).not.toContain('payload');
    expect(storage.find).toHaveBeenCalledOnce();
});
it.each([null, {}, [row(), row()], [{ ...row(), user_id: other }], [{ ...row(), revision_id: other }], [{ ...row(), revisionHash: 'd'.repeat(64) }], [{ ...row(), created_at: 'infinity' }], [{ ...row(), bytes: 67108865 }], [{ ...row(), extra: true }]].map(value => ({ value })))('refuses unavailable or contradictory history before object reads: %#', async ({ value }) => {
    const storage = { find: vi.fn(async () => receipt()), put: vi.fn() };
    await expect(findDneskaiReelForRevision(db(async () => Response.json(value)), owner, revision, hash, storage)).rejects.toMatchObject({ code: 'reel-storage-failed', message: 'reel-storage-failed' });
    expect(storage.find).not.toHaveBeenCalled();
});
it('only treats a confirmed empty matching history as absent', async () => {
    const storage = { find: vi.fn(), put: vi.fn() };
    expect(await findDneskaiReelForRevision(db(async () => Response.json([])), owner, revision, hash, storage)).toBeNull();
    expect(storage.find).not.toHaveBeenCalled();
});
it.each([null, { ...receipt(), bytes: 999 }, { ...receipt(), sha256: 'd'.repeat(64) }, { ...receipt(), reelKey: 'd'.repeat(64) }, { ...receipt(), url: 'http://example.test/file' }, { ...receipt(), url: 'https://user:password@example.test/file' }, { ...receipt(), extra: true }].map(value => ({ value })))('holds contradictory or missing storage rather than requesting a second encode: %#', async ({ value }) => {
    const storage = { find: vi.fn(async () => value), put: vi.fn() };
    await expect(findDneskaiReelForRevision(db(async () => Response.json([row()])), owner, revision, hash, storage as never)).rejects.toMatchObject({ code: 'reel-storage-failed', message: 'reel-storage-failed' });
});
it.each(['metadata', 'storage'] as const)('bounds an uncooperative %s read without another phase', async (phase) => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const fetcher = vi.fn(async () => phase === 'metadata' ? new Promise<Response>(() => {
    }) : Response.json([row()])), storage = { find: vi.fn(() => new Promise<ReturnType<typeof receipt>>(() => {
        })), put: vi.fn() };
    const pending = findDneskaiReelForRevision(db(fetcher), owner, revision, hash, storage).catch(error => error);
    await vi.waitFor(() => expect(phase === 'metadata' ? fetcher : storage.find).toHaveBeenCalledOnce());
    controller.abort('TEST_ONLY_PRIVATE_REASON');
    expect(await pending).toMatchObject({ code: 'reel-storage-failed', message: 'reel-storage-failed' });
    expect(fetcher).toHaveBeenCalledOnce();
    if (phase === 'metadata')
        expect(storage.find).not.toHaveBeenCalled();
});
it('refuses invalid selectors and an already retired owner lifetime before transport', async () => {
    const fetcher = vi.fn(), controller = new AbortController();
    controller.abort('TEST_ONLY_PRIVATE_REASON');
    await expect(findDneskaiReelForRevision(db(fetcher), owner, revision, hash, undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError', message: 'Request aborted' });
    await expect(findDneskaiReelForRevision(db(fetcher), owner, 'bad', hash)).rejects.toHaveProperty('code', 'reel-storage-failed');
    expect(fetcher).not.toHaveBeenCalled();
});
it('stops storage signing after the captured lifetime retires during metadata', async () => {
    const controller = new AbortController();
    const info = vi.fn(async () => ({ data: {}, error: null })), sign = vi.fn(), bucket = vi.fn(async () => {
        controller.abort('TEST_ONLY_PRIVATE_REASON');
        return { data: { public: false }, error: null };
    });
    const client = db(async () => Response.json([row()]));
    Object.assign(client.storage, { getBucket: bucket, from: () => ({ info, createSignedUrl: sign }) });
    await expect(findDneskaiReelForRevision(client, owner, revision, hash, undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError', message: 'Request aborted' });
    expect(info).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
});
it('does not retry failed metadata or turn it into confirmed absence', async () => {
    const fetcher = vi.fn(async () => Response.json({ message: 'TEST_ONLY_PRIVATE_DETAIL' }, { status: 503 })), storage = { find: vi.fn(), put: vi.fn() };
    await expect(findDneskaiReelForRevision(db(fetcher), owner, revision, hash, storage)).rejects.toMatchObject({ code: 'reel-storage-failed', message: 'reel-storage-failed' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(storage.find).not.toHaveBeenCalled();
});
