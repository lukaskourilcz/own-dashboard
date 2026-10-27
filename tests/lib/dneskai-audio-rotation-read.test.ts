import { createClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
import { nextDneskaiAudioTrackId } from '@/lib/marketing/dneskai-audio';
vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111', previousId = '33333333-3333-4333-8333-333333333333', id = '44444444-4444-4444-8444-444444444444';
const before = () => ({ id: previousId, user_id: owner, created_at: '2026-10-27T10:00:00.000001Z' });
const row = () => ({ id, user_id: owner, created_at: '2026-10-27T10:00:00.000002Z', enabled: true, source: 'original', storage_path: 'marketing-audio/' + owner + '/' + id + '.mp3' });
const db = (fetcher: typeof fetch) => createClient('https://audio-rotation.supabase.co', 'TEST-ONLY-service', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } });
const queued = (values: unknown[]) => {
    const urls: URL[] = [];
    const fetcher = vi.fn(async (url) => {
        urls.push(new URL(String(url)));
        if (!values.length)
            throw Error('Unexpected fixture request');
        return Response.json(values.shift());
    });
    return { client: db(fetcher), fetcher, urls };
};
afterEach(() => vi.restoreAllMocks());
it('uses one strict eligible read for a first rotation choice', async () => {
    const f = queued([[row()]]);
    expect(await nextDneskaiAudioTrackId(f.client, owner, null)).toBe(id);
    expect(f.urls[0].searchParams.get('user_id')).toBe('eq.' + owner);
    expect(f.urls[0].searchParams.get('enabled')).toBe('eq.true');
    expect(f.urls[0].searchParams.get('source')).toBe('neq.instagram-library');
    expect(f.urls[0].searchParams.get('order')).toBe('created_at.asc,id.asc');
    expect(f.urls[0].searchParams.get('limit')).toBe('1');
});
it('captures the full predecessor microsecond before a single after-boundary read', async () => {
    const f = queued([[before()], [row()]]);
    expect(await nextDneskaiAudioTrackId(f.client, owner, previousId)).toBe(id);
    expect(f.urls).toHaveLength(2);
    expect(f.urls[1].searchParams.get('or')).toBe('(created_at.gt.2026-10-27T10:00:00.000001Z,and(created_at.eq.2026-10-27T10:00:00.000001Z,id.gt.' + previousId + '))');
});
it('wraps after a confirmed empty tail and keeps a confirmed empty library null', async () => {
    const f = queued([[before()], [], [row()]]);
    expect(await nextDneskaiAudioTrackId(f.client, owner, previousId)).toBe(id);
    expect(f.urls).toHaveLength(3);
    expect(f.urls[2].searchParams.has('or')).toBe(false);
    expect(await nextDneskaiAudioTrackId(queued([[]]).client, owner, null)).toBeNull();
});
it.each([{ ...row(), user_id: previousId }, { ...row(), id: 'bad' }, { ...row(), enabled: false }, { ...row(), source: 'instagram-library' }, { ...row(), storage_path: 'marketing-audio/' + previousId + '/' + id + '.mp3' }, { ...row(), created_at: 'infinity' }, { ...row(), extra: true }])('refuses an unconfirmed eligible row: %#', async (value) => {
    const f = queued([[value]]);
    await expect(nextDneskaiAudioTrackId(f.client, owner, null)).rejects.toMatchObject({ code: 'audio-library-unavailable', message: 'audio-library-unavailable' });
    expect(f.urls).toHaveLength(1);
});
it.each([{ ...before(), id }, { ...before(), user_id: id }, { ...before(), created_at: 'infinity' }])('does not replace invalid predecessor evidence with a first choice: %#', async (value) => {
    const f = queued([[value], [row()]]);
    await expect(nextDneskaiAudioTrackId(f.client, owner, previousId)).rejects.toHaveProperty('code', 'audio-library-unavailable');
    expect(f.urls).toHaveLength(1);
});
it('refuses an after-boundary result that goes backwards', async () => {
    const f = queued([[before()], [{ ...row(), created_at: '2026-10-27T10:00:00.000000Z' }]]);
    await expect(nextDneskaiAudioTrackId(f.client, owner, previousId)).rejects.toHaveProperty('code', 'audio-library-unavailable');
    expect(f.urls).toHaveLength(2);
});
it('bounds a stalled first choice once without retry', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const fetcher = vi.fn(() => new Promise<Response>(() => {
    }));
    const pending = nextDneskaiAudioTrackId(db(fetcher), owner, null).catch(error => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    controller.abort('TEST_ONLY_PRIVATE_TIMEOUT');
    expect(await pending).toMatchObject({ code: 'audio-library-unavailable', message: 'audio-library-unavailable' });
    expect(fetcher).toHaveBeenCalledOnce();
});
it('does no request for a retired or invalid original selector', async () => {
    const controller = new AbortController();
    controller.abort('TEST_ONLY_PRIVATE_REASON');
    const fetcher = vi.fn();
    await expect(nextDneskaiAudioTrackId(db(fetcher), owner, null, controller.signal)).rejects.toMatchObject({ name: 'AbortError', message: 'Request aborted' });
    await expect(nextDneskaiAudioTrackId(db(fetcher), owner, 'bad')).rejects.toHaveProperty('code', 'audio-library-unavailable');
    expect(fetcher).not.toHaveBeenCalled();
});
it('starts no eligible phase after predecessor cancellation', async () => {
    const controller = new AbortController(), fetcher = vi.fn(async () => {
        controller.abort('TEST_ONLY_PRIVATE_REASON');
        return Response.json([before()]);
    });
    await expect(nextDneskaiAudioTrackId(db(fetcher), owner, previousId, controller.signal)).rejects.toMatchObject({ name: 'AbortError', message: 'Request aborted' });
    expect(fetcher).toHaveBeenCalledOnce();
});
