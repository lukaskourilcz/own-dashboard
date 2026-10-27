import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { dneskaiReelForRevision } from '@/lib/marketing/dneskai-reel';
import { revisionContentHash } from '@/lib/marketing/hashes';
import { DNESKAI_RENDER_REPORT_VERSION } from '@/lib/marketing/contracts';
import { deckRevision } from './marketing-dneskai-revision-fixture';
vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222', bytes = Buffer.from('TEST_ONLY_JPEG'), digest = createHash('sha256').update(bytes).digest('hex');
const revision = { ...deckRevision(), assets: deckRevision().assets.map(asset => ({ ...asset, sha256: digest })) }, hash = revisionContentHash(revision);
function fixture(patch: Record<string, unknown> = {}) {
    const row = {
        id, user_id: owner, revision, content_hash: hash, status: 'approved', ready: true, approved_hash: hash, render_report: { schemaVersion: DNESKAI_RENDER_REPORT_VERSION, status: 'rendered', problems: [], renderKeys: ['a', 'b', 'c'].map(v => v.repeat(64)), renderedAt: '2026-10-27T12:00:00Z' }, ...patch
    };
    const fetcher = vi.fn(async (input: unknown) => {
        const select = new URL(String(input)).searchParams.get('select')!;
        return Response.json([Object.fromEntries(select.split(',').map(key => [key, row[key as keyof typeof row]]))]);
    });
    const db = createClient('https://reel-intent.supabase.co', 'TEST-ONLY-service', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } });
    const deps = {
        loadAudio: vi.fn(async () => null), loadSlide: vi.fn(async () => bytes), render: vi.fn(async () => ({ bytes: Buffer.from('TEST_ONLY_MP4'), durationSeconds: 9.5, silent: true, sha256: digest, slideCount: 3 })), storage: { find: vi.fn(async (reelKey: string) => ({ reelKey, url: 'https://test-only.supabase.co/reel.mp4', sha256: digest, bytes: 1000 })), put: vi.fn() }
    };
    return { db, deps, fetcher, row };
}
afterEach(() => vi.restoreAllMocks());
it('refuses a revision changed after signed preparation captured a different approved hash', async () => {
    const { db, deps } = fixture();
    await expect(dneskaiReelForRevision(db, owner, id, { ...deps, approvedRevisionHash: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'reel-revision-unavailable' });
    expect(deps.loadAudio).not.toHaveBeenCalled();
    expect(deps.storage.find).not.toHaveBeenCalled();
    expect(deps.render).not.toHaveBeenCalled();
});
it('refuses withdrawn approval before any audio or cache work', async () => {
    const { db, deps } = fixture({ status: 'review', ready: false, approved_hash: null });
    await expect(dneskaiReelForRevision(db, owner, id, { ...deps, approvedRevisionHash: hash })).rejects.toMatchObject({ code: 'reel-revision-unavailable' });
    expect(deps.loadAudio).not.toHaveBeenCalled();
    expect(deps.storage.find).not.toHaveBeenCalled();
});
it('reuses a verified cache hit with one exact approved-intent read', async () => {
    const { db, deps, fetcher } = fixture();
    expect(await dneskaiReelForRevision(db, owner, id, { ...deps, approvedRevisionHash: hash })).toMatchObject({ cached: true, revisionHash: hash });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(deps.render).not.toHaveBeenCalled();
});
it('retains explicit owner draft preview without requiring publication approval', async () => {
    const { db, deps, fetcher } = fixture({ status: 'review', ready: false, approved_hash: null });
    expect(await dneskaiReelForRevision(db, owner, id, deps)).toMatchObject({ cached: true });
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('select')).toBe('id,user_id,revision,content_hash,render_report');
});
it.each([{ status: 'review', ready: false, approved_hash: null }, { content_hash: 'f'.repeat(64) }, { user_id: '33333333-3333-4333-8333-333333333333' }])('refuses an intent changed while slide inputs were loading: %#', async (patch) => {
    const { db, deps, row } = fixture();
    deps.storage.find.mockResolvedValue(null as never);
    deps.loadSlide.mockImplementationOnce(async () => {
        Object.assign(row, patch);
        return bytes;
    });
    await expect(dneskaiReelForRevision(db, owner, id, { ...deps, approvedRevisionHash: hash })).rejects.toMatchObject({ code: 'reel-revision-unavailable' });
    expect(deps.render).not.toHaveBeenCalled();
    expect(deps.storage.put).not.toHaveBeenCalled();
});
it('renders the exact approved intent after a final positive recheck', async () => {
    const { db, deps, fetcher } = fixture();
    deps.storage.find.mockResolvedValue(null as never);
    deps.storage.put.mockResolvedValue({ reelKey: 'a'.repeat(64), url: 'https://test-only.supabase.co/reel.mp4', sha256: digest, bytes: 13 } as never);
    expect(await dneskaiReelForRevision(db, owner, id, { ...deps, approvedRevisionHash: hash })).toMatchObject({ cached: false, revisionHash: hash });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(deps.render).toHaveBeenCalledOnce();
    expect(deps.storage.put).toHaveBeenCalledOnce();
});
it('bounds an unavailable final approval check without starting the encoder', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 15000 ? deadline.signal : new AbortController().signal);
    const { db, deps, fetcher } = fixture();
    deps.storage.find.mockResolvedValue(null as never);
    const first = fetcher.getMockImplementation()!;
    fetcher.mockImplementationOnce(first).mockImplementationOnce(() => new Promise<Response>(() => {
    }));
    const pending = dneskaiReelForRevision(db, owner, id, { ...deps, approvedRevisionHash: hash }).catch(error => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    deadline.abort('TEST_ONLY_PRIVATE_REASON');
    expect(await pending).toMatchObject({ code: 'reel-revision-unavailable', message: 'reel-revision-unavailable' });
    expect(deps.render).not.toHaveBeenCalled();
    expect(deps.storage.put).not.toHaveBeenCalled();
});
it.each(['', 'BAD', 'A'.repeat(64)])('refuses invalid captured hashes before any read: %s', async (approvedRevisionHash) => {
    const { db, deps, fetcher } = fixture();
    await expect(dneskaiReelForRevision(db, owner, id, { ...deps, approvedRevisionHash })).rejects.toHaveProperty('code', 'reel-revision-unavailable');
    expect(fetcher).not.toHaveBeenCalled();
});
