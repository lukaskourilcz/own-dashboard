import { createClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
import { dneskaiReelForRevision, type DneskaiReelDependencies } from '@/lib/marketing/dneskai-reel';
import { revisionContentHash } from '@/lib/marketing/hashes';
import { DNESKAI_RENDER_REPORT_VERSION } from '@/lib/marketing/contracts';
import { deckRevision } from './marketing-dneskai-revision-fixture';
vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111', id = '22222222-2222-4222-8222-222222222222', other = '33333333-3333-4333-8333-333333333333';
const revision = deckRevision(), row = () => ({
    id, user_id: owner, revision, content_hash: revisionContentHash(revision), render_report: { schemaVersion: DNESKAI_RENDER_REPORT_VERSION, status: 'rendered', problems: [], renderKeys: ['a', 'b', 'c'].map(value => value.repeat(64)), renderedAt: '2026-10-27T10:00:00Z' }
});
const db = (fetcher: typeof fetch) => createClient('https://reel-revision.supabase.co', 'TEST-ONLY-service', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } });
const dependencies = () => ({
    loadAudio: vi.fn(async () => null), loadSlide: vi.fn(), render: vi.fn(), storage: { find: vi.fn(async (reelKey: string) => ({ reelKey, url: 'https://test-only.supabase.co/reel.mp4', sha256: 'd'.repeat(64), bytes: 1000 })), put: vi.fn() }
} satisfies DneskaiReelDependencies);
afterEach(() => vi.restoreAllMocks());
it('reads exact owned revision identity once with a complete positive projection before cache reuse', async () => {
    let query!: URL;
    const fetcher = vi.fn(async (url) => {
        query = new URL(String(url));
        return Response.json([row()]);
    }), deps = dependencies();
    expect(await dneskaiReelForRevision(db(fetcher), owner, id, deps)).toMatchObject({ cached: true, revisionHash: row().content_hash });
    expect(query.searchParams.get('id')).toBe('eq.' + id);
    expect(query.searchParams.get('user_id')).toBe('eq.' + owner);
    expect(query.searchParams.get('select')).toBe('id,user_id,revision,content_hash,render_report');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(deps.loadAudio.mock.calls[0]).toHaveLength(2);
    expect(deps.loadSlide).not.toHaveBeenCalled();
    expect(deps.render).not.toHaveBeenCalled();
});
it.each([[], [{ ...row(), id: other }], [{ ...row(), user_id: other }], [{ ...row(), extra: true }], [{ ...row(), content_hash: 'bad' }], [row(), row()]].map(value => ({ value })))('starts no media work from missing, contradictory or malformed returned revision: %#', async ({ value }) => {
    const deps = dependencies(), fetcher = vi.fn(async () => Response.json(value));
    await expect(dneskaiReelForRevision(db(fetcher), owner, id, deps)).rejects.toMatchObject({ code: 'reel-revision-unavailable', message: 'reel-revision-unavailable' });
    expect(deps.loadAudio).not.toHaveBeenCalled();
    expect(deps.storage.find).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
});
it('bounds uncooperative revision metadata and never advances after its late result', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 15000 ? deadline.signal : new AbortController().signal);
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(done => {
        resolve = done;
    })), deps = dependencies();
    const pending = dneskaiReelForRevision(db(fetcher), owner, id, deps).catch(error => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    deadline.abort('TEST_ONLY_PRIVATE_REASON');
    expect(await pending).toMatchObject({ code: 'reel-revision-unavailable', message: 'reel-revision-unavailable' });
    resolve(Response.json([row()]));
    await Promise.resolve();
    expect(deps.loadAudio).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
});
it('refuses an unavailable metadata response once without an SDK retry or private diagnostics', async () => {
    const fetcher = vi.fn(async () => Response.json({ message: 'TEST_ONLY_PRIVATE_DETAIL' }, { status: 503 })), deps = dependencies();
    await expect(dneskaiReelForRevision(db(fetcher), owner, id, deps)).rejects.toMatchObject({ code: 'reel-revision-unavailable', message: 'reel-revision-unavailable' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(deps.loadAudio).not.toHaveBeenCalled();
});
