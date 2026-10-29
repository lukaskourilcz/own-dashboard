import { createClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
import { lastDneskaiReelAudio } from '@/lib/marketing/dneskai-reel';
vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111', revision = '22222222-2222-4222-8222-222222222222', other = '33333333-3333-4333-8333-333333333333', event = '44444444-4444-4444-8444-444444444444', audio = '55555555-5555-4555-8555-555555555555';
const row = () => ({
    id: event, user_id: owner, revision_id: other, kind: 'dneskai-reel-rendered', created_at: '2026-10-27T10:00:00.000001Z', reelKey: 'a'.repeat(64), revisionHash: 'b'.repeat(64), audioId: audio, sha256: 'c'.repeat(64), bytes: 1000
});
const db = (fetcher: typeof fetch) => createClient('https://audio-history.supabase.co', 'TEST-ONLY-service', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } });
afterEach(() => vi.restoreAllMocks());
it('refuses an unconfirmed latest recorded audio instead of treating it as silence', async () => {
    const fetcher = vi.fn(async () => Response.json([{ ...row(), audioId: undefined }]));
    await expect(lastDneskaiReelAudio(db(fetcher), owner, revision)).rejects.toHaveProperty('code', 'reel-storage-failed');
    expect(fetcher).toHaveBeenCalledOnce();
});
it.each([[], [{ ...row(), audioId: null }]].map(value => ({ value })))('keeps confirmed empty history or a silent record distinct from unavailable data: %#', async ({ value }) => {
    const fetcher = vi.fn(async () => Response.json(value));
    expect(await lastDneskaiReelAudio(db(fetcher), owner, revision)).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
});
it('validates one owned latest record with a deterministic order and positive JSON-field projection', async () => {
    let query!: URL;
    const fetcher = vi.fn(async (url) => {
        query = new URL(String(url));
        return Response.json([row()]);
    });
    expect(await lastDneskaiReelAudio(db(fetcher), owner, revision)).toBe(audio);
    expect(query.searchParams.get('user_id')).toBe('eq.' + owner);
    expect(query.searchParams.get('revision_id')).toBe('neq.' + revision);
    expect(query.searchParams.get('kind')).toBe('eq.dneskai-reel-rendered');
    expect(query.searchParams.get('order')).toBe('created_at.desc,id.desc');
    expect(query.searchParams.get('limit')).toBe('1');
    expect(query.searchParams.get('select')).toContain('audioId:payload->audioId');
    expect(query.searchParams.get('select')!.split(',')).not.toContain('payload');
});
it.each([null, {}, [row(), row()], [{ ...row(), user_id: other }], [{ ...row(), revision_id: revision }], [{ ...row(), kind: 'other' }], [{ ...row(), created_at: 'infinity' }], [{ ...row(), extra: true }], [{ ...row(), audioId: 'bad' }], [{ ...row(), bytes: 67108865 }]].map(value => ({ value })))('refuses incomplete, contradictory or unbounded latest metadata: %#', async ({ value }) => {
    const fetcher = vi.fn(async () => Response.json(value));
    await expect(lastDneskaiReelAudio(db(fetcher), owner, revision)).rejects.toMatchObject({ code: 'reel-storage-failed', message: 'reel-storage-failed' });
    expect(fetcher).toHaveBeenCalledOnce();
});
it('bounds a stalled history request once', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const fetcher = vi.fn(() => new Promise<Response>(() => {
    }));
    const pending = lastDneskaiReelAudio(db(fetcher), owner, revision).catch(error => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    controller.abort('TEST_ONLY_PRIVATE_REASON');
    expect(await pending).toMatchObject({ code: 'reel-storage-failed', message: 'reel-storage-failed' });
    expect(fetcher).toHaveBeenCalledOnce();
});
it('starts no history request for invalid or retired original scope', async () => {
    const controller = new AbortController();
    controller.abort('TEST_ONLY_PRIVATE_REASON');
    const fetcher = vi.fn();
    await expect(lastDneskaiReelAudio(db(fetcher), owner, revision, controller.signal)).rejects.toMatchObject({ name: 'AbortError', message: 'Request aborted' });
    await expect(lastDneskaiReelAudio(db(fetcher), 'bad', revision)).rejects.toHaveProperty('code', 'reel-storage-failed');
    expect(fetcher).not.toHaveBeenCalled();
});
