import { createClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
import { readDneskaiAudioObjectPresence } from '@/lib/marketing/dneskai-audio';
vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111', id = '33333333-3333-4333-8333-333333333333';
const receipt = () => ({ ownerId: owner, id, contentType: 'audio/mpeg', state: 'absent' });
const db = (fetcher: typeof fetch) => createClient('https://object-proof.supabase.co', 'TEST-ONLY-service', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } });
afterEach(() => vi.restoreAllMocks());
it.each([null, {}, { ...receipt(), ownerId: id }, { ...receipt(), id: owner }, { ...receipt(), contentType: 'audio/wav' }, { ...receipt(), state: 'unknown' }, { ...receipt(), extra: true }])('refuses unconfirmed object presence: %#', async (value) => {
    const fetcher = vi.fn(async () => Response.json(value));
    await expect(readDneskaiAudioObjectPresence(db(fetcher), owner, id, 'audio/mpeg')).rejects.toMatchObject({ code: 'audio-library-unavailable', message: 'audio-library-unavailable' });
    expect(fetcher).toHaveBeenCalledOnce();
});
it('does not retry a failed proof or expose its private error', async () => {
    const fetcher = vi.fn(async () => Response.json({ message: 'TEST_ONLY_PRIVATE_DETAIL', code: '40001' }, { status: 503 }));
    await expect(readDneskaiAudioObjectPresence(db(fetcher), owner, id, 'audio/mpeg')).rejects.toMatchObject({ code: 'audio-library-unavailable', message: 'audio-library-unavailable' });
    expect(fetcher).toHaveBeenCalledOnce();
});
it('bounds an uncooperative proof wait without a second request', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const fetcher = vi.fn(() => new Promise<Response>(() => {
    }));
    const result = readDneskaiAudioObjectPresence(db(fetcher), owner, id, 'audio/mpeg').catch(error => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    controller.abort('TEST_ONLY_PRIVATE_REASON');
    expect(await result).toMatchObject({ code: 'audio-library-unavailable', message: 'audio-library-unavailable' });
    expect(fetcher).toHaveBeenCalledOnce();
});
it('starts no proof for an already retired caller', async () => {
    const controller = new AbortController();
    controller.abort('TEST_ONLY_PRIVATE_REASON');
    const fetcher = vi.fn();
    await expect(readDneskaiAudioObjectPresence(db(fetcher), owner, id, 'audio/mpeg', controller.signal)).rejects.toMatchObject({ name: 'AbortError', message: 'Request aborted' });
    expect(fetcher).not.toHaveBeenCalled();
});
it('ignores an uncooperative late absence after caller retirement', async () => {
    const controller = new AbortController();
    let finish!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => {
        finish = resolve;
    }));
    const result = readDneskaiAudioObjectPresence(db(fetcher), owner, id, 'audio/mpeg', controller.signal).catch(error => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    controller.abort('TEST_ONLY_PRIVATE_REASON');
    expect(await result).toMatchObject({ name: 'AbortError', message: 'Request aborted' });
    finish(Response.json(receipt()));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fetcher).toHaveBeenCalledOnce();
});
