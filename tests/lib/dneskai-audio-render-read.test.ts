import { createClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
import { loadDneskaiAudioTrack } from '@/lib/marketing/dneskai-audio';
import { DNESKAI_AUDIO_MAX_BYTES } from '@/lib/marketing/dneskai-audio-contracts';
vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111', id = '33333333-3333-4333-8333-333333333333', other = '22222222-2222-4222-8222-222222222222';
const row = () => ({ id, user_id: owner, storage_path: 'marketing-audio/' + owner + '/' + id + '.mp3' });
function client(record: unknown, body: () => Response) {
    return createClient('https://render-audio.supabase.co', 'TEST-ONLY-service', { global: { fetch: async (url) => new URL(String(url)).pathname.startsWith('/rest/') ? Response.json([record]) : body() }, auth: { persistSession: false, autoRefreshToken: false } });
}
afterEach(() => vi.restoreAllMocks());
it('refuses an audio row whose returned identity differs from the approved track', async () => {
    await expect(loadDneskaiAudioTrack(client({ ...row(), id: other }, () => new Response('fixture')), owner, id)).rejects.toHaveProperty('code', 'audio-track-unavailable');
});
it.each([0, DNESKAI_AUDIO_MAX_BYTES + 1])('refuses an unsupported rendered file length: %s', async (size) => {
    expect(await loadDneskaiAudioTrack(client(row(), () => new Response(new Uint8Array(size))), owner, id).then(() => 'unexpected-success', error => error.code)).toBe('audio-track-unavailable');
});
it.each([{ ...row(), user_id: other }, { ...row(), extra: true }, { ...row(), id: null }, { ...row(), storage_path: 'marketing-audio/' + other + '/' + id + '.mp3' }, { ...row(), storage_path: 'marketing-audio/' + owner + '/' + other + '.mp3' }])('refuses unconfirmed renderer metadata before file transfer: %#', async (record) => {
    const body = vi.fn(() => new Response('fixture'));
    await expect(loadDneskaiAudioTrack(client(record, body), owner, id)).rejects.toHaveProperty('code', 'audio-track-unavailable');
    expect(body).not.toHaveBeenCalled();
});
it('collects a supported file as a stream without materializing an SDK Blob', async () => {
    const response = new Response('fixture'), blob = vi.spyOn(response, 'blob');
    const result = await loadDneskaiAudioTrack(client(row(), () => response), owner, id);
    expect(result.bytes.toString()).toBe('fixture');
    expect(blob).not.toHaveBeenCalled();
});
it('accepts the exact byte ceiling and stops a larger stream before consuming its tail', async () => {
    const exact = await loadDneskaiAudioTrack(client(row(), () => new Response(new Uint8Array(DNESKAI_AUDIO_MAX_BYTES))), owner, id);
    expect(exact.bytes.length).toBe(DNESKAI_AUDIO_MAX_BYTES);
    let pulls = 0;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
            pulls++;
            if (pulls <= 32)
                controller.enqueue(new Uint8Array(1024 * 1024));
            else
                controller.close();
        }, cancel });
    await expect(loadDneskaiAudioTrack(client(row(), () => new Response(stream)), owner, id)).rejects.toHaveProperty('code', 'audio-track-unavailable');
    expect(pulls).toBeLessThanOrEqual(22);
    expect(cancel).toHaveBeenCalledOnce();
});
it('contains failed stream diagnostics', async () => {
    const response = new Response(new ReadableStream({ start(controller) {
            controller.error(new Error('TEST_ONLY_PRIVATE_STREAM_DETAIL'));
        } }));
    await expect(loadDneskaiAudioTrack(client(row(), () => response), owner, id)).rejects.toMatchObject({ code: 'audio-track-unavailable', message: 'audio-track-unavailable' });
});
it('bounds an empty-chunk producer instead of retaining an unbounded sequence', async () => {
    let pulls = 0;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
            pulls++;
            controller.enqueue(new Uint8Array());
        }, cancel });
    await expect(loadDneskaiAudioTrack(client(row(), () => new Response(stream)), owner, id)).rejects.toHaveProperty('code', 'audio-track-unavailable');
    expect(pulls).toBeLessThanOrEqual(65538);
    expect(cancel).toHaveBeenCalledOnce();
});
it('bounds a stalled body and does not await an uncooperative cancellation hook', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const cancel = vi.fn(() => new Promise<void>(() => {
    })), response = new Response(new ReadableStream({ cancel }));
    const pending = loadDneskaiAudioTrack(client(row(), () => response), owner, id).catch(error => error);
    await vi.waitFor(() => expect(response.body?.locked).toBe(true));
    controller.abort('TEST_ONLY_PRIVATE_TIMEOUT');
    expect(await pending).toMatchObject({ code: 'audio-track-unavailable', message: 'audio-track-unavailable' });
    expect(cancel).toHaveBeenCalledOnce();
});
it('makes one bounded metadata request without retrying or starting file work', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const fetcher = vi.fn(() => new Promise<Response>(() => {
    })), db = createClient('https://render-audio.supabase.co', 'TEST-ONLY-service', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } });
    const pending = loadDneskaiAudioTrack(db, owner, id).catch(error => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    controller.abort('TEST_ONLY_PRIVATE_TIMEOUT');
    expect(await pending).toHaveProperty('code', 'audio-track-unavailable');
    expect(fetcher).toHaveBeenCalledOnce();
});
it('does no work for an already cancelled caller', async () => {
    const controller = new AbortController();
    controller.abort('TEST_ONLY_PRIVATE_REASON');
    const body = vi.fn(() => new Response('fixture'));
    await expect(loadDneskaiAudioTrack(client(row(), body), owner, id, controller.signal)).rejects.toMatchObject({ name: 'AbortError', message: 'Request aborted' });
    expect(body).not.toHaveBeenCalled();
});
it('discards a late file body after original caller cancellation', async () => {
    const controller = new AbortController(), cancel = vi.fn();
    let finish!: (value: Response) => void;
    const db = createClient('https://render-audio.supabase.co', 'TEST-ONLY-service', {
        global: { fetch: async (url) => new URL(String(url)).pathname.startsWith('/rest/') ? Response.json([row()]) : new Promise<Response>(resolve => {
                finish = resolve;
            }) }, auth: { persistSession: false, autoRefreshToken: false }
    });
    const pending = loadDneskaiAudioTrack(db, owner, id, controller.signal).catch(error => error);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    controller.abort('TEST_ONLY_PRIVATE_REASON');
    expect(await pending).toMatchObject({ name: 'AbortError', message: 'Request aborted' });
    finish(new Response(new ReadableStream({ cancel })));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
});
