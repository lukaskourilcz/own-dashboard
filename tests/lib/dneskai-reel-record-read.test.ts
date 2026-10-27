import { createClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
import { recordDneskaiReel } from '@/lib/marketing/dneskai-reel';
vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111', revision = '22222222-2222-4222-8222-222222222222', other = '33333333-3333-4333-8333-333333333333';
const record = () => ({ reelKey: 'c'.repeat(64), revisionHash: 'a'.repeat(64), audioId: null, sha256: 'd'.repeat(64), bytes: 1000 });
const receipt = () => ({ ...record(), ownerId: owner, revisionId: revision, eventId: other, createdAt: '2026-10-27T12:00:00.000001Z', created: true });
const db = (fetcher: typeof fetch) => createClient('https://reel-record-proof.supabase.co', 'TEST-ONLY-service', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } });
afterEach(() => vi.restoreAllMocks());
it('requires the exact positive persisted tuple and carries its original lifetime into one RPC', async () => {
    let path!: URL, body!: unknown;
    const fetcher = vi.fn(async (url, init) => {
        path = new URL(String(url));
        body = JSON.parse(String(init?.body));
        return Response.json(receipt());
    });
    await expect(recordDneskaiReel(db(fetcher), owner, revision, record())).resolves.toBeUndefined();
    expect(path.pathname).toBe('/rest/v1/rpc/record_owned_dneskai_reel');
    expect(body).toEqual({ p_owner: owner, p_revision: revision, p_revision_hash: 'a'.repeat(64), p_reel_key: 'c'.repeat(64), p_audio_id: null, p_sha256: 'd'.repeat(64), p_bytes: 1000 });
    expect(fetcher).toHaveBeenCalledOnce();
});
it.each([null, [], { ...receipt(), ownerId: other }, { ...receipt(), revisionId: other }, { ...receipt(), revisionHash: 'b'.repeat(64) }, { ...receipt(), reelKey: 'e'.repeat(64) }, { ...receipt(), audioId: other }, { ...receipt(), bytes: 1001 }, { ...receipt(), sha256: 'e'.repeat(64) }, { ...receipt(), eventId: 'bad' }, { ...receipt(), createdAt: 'infinity' }, { ...receipt(), created: 'true' }, { ...receipt(), extra: true }].map(value => ({ value })))('refuses incomplete, contradictory or future persisted acknowledgement: %#', async ({ value }) => {
    const fetcher = vi.fn(async () => Response.json(value));
    await expect(recordDneskaiReel(db(fetcher), owner, revision, record())).rejects.toMatchObject({ code: 'reel-storage-failed', message: 'reel-storage-failed' });
    expect(fetcher).toHaveBeenCalledOnce();
});
it('does not retry or expose a failed commit acknowledgement', async () => {
    const fetcher = vi.fn(async () => Response.json({ message: 'TEST_ONLY_PRIVATE_DETAIL' }, { status: 503 }));
    await expect(recordDneskaiReel(db(fetcher), owner, revision, record())).rejects.toMatchObject({ code: 'reel-storage-failed', message: 'reel-storage-failed' });
    expect(fetcher).toHaveBeenCalledOnce();
});
it('bounds an uncooperative record acknowledgement without another write', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const fetcher = vi.fn(() => new Promise<Response>(() => {
    })), pending = recordDneskaiReel(db(fetcher), owner, revision, record()).catch(error => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    deadline.abort('TEST_ONLY_PRIVATE_REASON');
    expect(await pending).toMatchObject({ code: 'reel-storage-failed', message: 'reel-storage-failed' });
    expect(fetcher).toHaveBeenCalledOnce();
});
it('starts no write after invalid or retired original scope', async () => {
    const fetcher = vi.fn(), caller = new AbortController();
    caller.abort('TEST_ONLY_PRIVATE_REASON');
    await expect(recordDneskaiReel(db(fetcher), owner, revision, record(), caller.signal)).rejects.toMatchObject({ name: 'AbortError', message: 'Request aborted' });
    await expect(recordDneskaiReel(db(fetcher), owner, 'bad', record())).rejects.toHaveProperty('code', 'reel-storage-failed');
    await expect(recordDneskaiReel(db(fetcher), owner, revision, { ...record(), bytes: 67108865 })).rejects.toHaveProperty('code', 'reel-storage-failed');
    expect(fetcher).not.toHaveBeenCalled();
});
