import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), db: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ ...mocks.db(), auth: { getUser: mocks.user } }) }));
import { GET } from '@/app/api/marketing/dneskai/media/route';
import { candidate } from '@/lib/marketing/dneskai-providers';
import { loadDneskaiMedia } from '@/lib/marketing/dneskai-client';
import { DneskaiMediaReadSchema } from '@/lib/marketing/dneskai-media-contracts';

const owner = '11111111-1111-4111-8111-111111111111';
const project = '22222222-2222-4222-8222-222222222222';
const sha = (n: number) => n.toString(16).padStart(64, '0');
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const at = '2026-10-20T21:30:00+00:00';
// OFFLINE rows shaped like PostgREST responses; signed links are synthetic.
const reel = { ...candidate('instagram:mosseri', 'OFFLINE-reel', 'OFFLINE reel', 'OFFLINE caption', 'https://www.instagram.com/reel/OFFLINE/', '2026-10-20T20:00:00Z', at, ['https://scontent.cdninstagram.com/v/cover.jpg']), status: 'selected' as const, targetDate: '2026-10-21', instagram: { ownerUsername: 'mosseri', mediaType: 'video' as const } };
const article = { ...candidate('hf-blog', 'OFFLINE-hf', 'OFFLINE article', 'OFFLINE text', 'https://huggingface.co/blog/offline', '2026-10-20T20:00:00Z', at), status: 'selected' as const, targetDate: '2026-10-21' };
const asset = (n: number, patch: Record<string, unknown> = {}) => ({ id: uuid(n), sha256: sha(n), width: 1440, height: 1800, mime: 'image/jpeg', bytes: 1000 + n, storage_path: `marketing-media/${owner}/${sha(n)}.jpg`, fetched_at: at, duplicate_of_asset_id: null, purged_at: null, ...patch });
const tables: Record<string, Array<Record<string, unknown>>> = {
  projects: [{ id: project, user_id: owner, portfolio_key: 'aifirst', repo_full_name: null, previous_repo_full_names: [], parent_id: null }],
  marketing_dneskai_candidates: [
    { id: reel.id, status: 'selected', candidate: reel, user_id: owner, project_id: project },
    { id: article.id, status: 'selected', candidate: article, user_id: owner, project_id: project },
  ],
  marketing_media_collections: [{ candidate_id: reel.id, status: 'partial', page_status: 'not-applicable', page_error: null, attempted_at: at, completed_at: at, skipped: [{ position: 1, code: 'media-http-403', retryable: false, attempts: 1 }], user_id: owner, project_id: project }],
  marketing_media_asset_links: [
    { candidate_id: reel.id, position: 2, origin_url: 'https://scontent.cdninstagram.com/v/2.jpg', origin_kind: 'instagram-child', credit: 'Foto: @mosseri', asset: asset(3, { width: 640, height: 800, duplicate_of_asset_id: uuid(1) }), user_id: owner, project_id: project },
    { candidate_id: reel.id, position: 0, origin_url: 'https://scontent.cdninstagram.com/v/cover.jpg', origin_kind: 'instagram-display', credit: 'Foto: @mosseri', asset: asset(1), user_id: owner, project_id: project },
    { candidate_id: reel.id, position: 3, origin_url: 'https://scontent.cdninstagram.com/v/3.jpg', origin_kind: 'instagram-child', credit: 'Foto: @mosseri', asset: asset(4, { width: 1200, height: 675, purged_at: at }), user_id: owner, project_id: project },
  ],
  marketing_media_assets: [{ id: uuid(1), sha256: sha(1), user_id: owner }],
};

function database(overrides: { failTable?: string; nullTable?: string; projectRow?: Record<string, unknown> | null } = {}) {
  const filters: Array<[string, string, string, unknown]> = [];
  const signed: Array<{ bucket: string; names: string[]; seconds: number }> = [];
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    let limit = Infinity;
    const query = {
      select: () => query,
      retry: () => query, abortSignal: () => query,
      eq: (field: string, value: unknown) => { filters.push([table, 'eq', field, value]); rows = rows.filter((row) => !(field in row) || row[field] === value); return query; },
      in: (field: string, values: unknown[]) => { filters.push([table, 'in', field, values]); rows = rows.filter((row) => values.includes(row[field])); return query; },
      order: () => query,
      limit: (count: number) => { limit = count; return query; },
      maybeSingle: async () => ({ data: overrides.projectRow !== undefined ? overrides.projectRow : rows[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(overrides.failTable === table
        ? { data: null, error: { message: 'private database detail' } }
        : { data: overrides.nullTable === table ? null : rows.slice(0, limit).map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !['user_id', 'project_id'].includes(key) || table === 'projects'))), error: null }).then(resolve, reject),
    };
    return query;
  };
  const storage = { from: (bucket: string) => ({ createSignedUrls: async (names: string[], seconds: number) => {
    signed.push({ bucket, names, seconds });
    return { data: names.map((path) => ({ path, signedUrl: `https://project.supabase.test/storage/v1/object/sign/${bucket}/${path}?token=TEST`, error: null })), error: null };
  } }) };
  return { db: { from, storage }, filters, signed };
}
const get = (query: string) => GET(new Request(`https://own.example/api/marketing/dneskai/media${query}`));

beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ data: { user: { id: owner } } }); mocks.db.mockReturnValue(database().db); });
afterEach(() => vi.unstubAllGlobals());

describe('GET /api/marketing/dneskai/media', () => {
  it('returns the owner tray in original order with credit, flags, duplicate marker and one-hour previews', async () => {
    const d = database(); mocks.db.mockReturnValue(d.db);
    const response = await get(`?projectId=${project}&candidateId=${reel.id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = DneskaiMediaReadSchema.parse(await response.json());
    expect(body.candidates).toHaveLength(1);
    const [tray] = body.candidates;
    expect(tray).toMatchObject({ candidateId: reel.id, captionOnly: true, mediaType: 'video', collection: { status: 'partial', skipped: [{ position: 1, code: 'media-http-403' }] } });
    expect(tray!.assets.map((row) => [row.position, row.sha256, row.credit, row.fullBleedCapable, row.insetCapable, row.duplicateOfSha256, row.purged])).toEqual([
      [0, sha(1), 'Foto: @mosseri', true, true, null, false],
      [2, sha(3), 'Foto: @mosseri', false, true, sha(1), false],
      [3, sha(4), 'Foto: @mosseri', false, true, null, true]]);
    expect(tray!.assets[0]!.previewUrl).toBe(`https://project.supabase.test/storage/v1/object/sign/marketing-media/${owner}/${sha(1)}.jpg?token=TEST`);
    expect(tray!.assets[2]!.previewUrl).toBeNull();
    expect(d.signed).toEqual([{ bucket: 'marketing-media', names: [`${owner}/${sha(3)}.jpg`, `${owner}/${sha(1)}.jpg`], seconds: 3600 }]);
    for (const table of ['projects', 'marketing_dneskai_candidates', 'marketing_media_collections', 'marketing_media_asset_links']) expect(d.filters).toContainEqual([table, 'eq', 'user_id', owner]);
    expect(d.filters).toContainEqual(['marketing_dneskai_candidates', 'eq', 'id', reel.id]);
  });

  it('lists the selected candidates when none is named and shows uncollected media as such', async () => {
    const d = database(); mocks.db.mockReturnValue(d.db);
    const body = DneskaiMediaReadSchema.parse(await (await get(`?projectId=${project}`)).json());
    expect(body.candidates.map((row) => [row.candidateId, row.captionOnly, row.collection?.status ?? null, row.assets.length])).toEqual([[reel.id, true, 'partial', 3], [article.id, false, null, 0]]);
    expect(d.filters).toContainEqual(['marketing_dneskai_candidates', 'eq', 'status', 'selected']);
  });

  it.each([
    ['unauthenticated', `?projectId=${project}`, 401],
    ['missing project', '', 400],
    ['invalid project', '?projectId=x', 400],
    ['invalid candidate', `?projectId=${project}&candidateId=${encodeURIComponent('../x y')}`, 400],
  ])('refuses %s', async (kind, query, status) => {
    if (kind === 'unauthenticated') mocks.user.mockResolvedValue({ data: { user: null } });
    expect((await get(query)).status).toBe(status);
  });

  it('refuses a project that is not the owner DNESKAi project', async () => {
    mocks.db.mockReturnValue(database({ projectRow: { id: project, user_id: owner, portfolio_key: 'own-dashboard', parent_id: null } }).db);
    expect((await get(`?projectId=${project}`)).status).toBe(404);
    mocks.db.mockReturnValue(database({ projectRow: null }).db);
    expect((await get(`?projectId=${project}`)).status).toBe(404);
  });

  it('never sends database detail to the caller', async () => {
    mocks.db.mockReturnValue(database({ failTable: 'marketing_media_asset_links' }).db);
    const response = await get(`?projectId=${project}`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'media-unavailable' });
  });
});

describe('loadDneskaiMedia (browser)', () => {
  it('requests the exact project and candidate, no-store, and validates the contract', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ schemaVersion: 'dneskai-media/1', candidates: [] }));
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    expect(await loadDneskaiMedia('a & b', 'c', signal)).toEqual({ schemaVersion: 'dneskai-media/1', candidates: [] });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/marketing/dneskai/media?projectId=a+%26+b&candidateId=c', { cache: 'no-store', signal });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'media-unavailable' }, { status: 503 })));
    await expect(loadDneskaiMedia(project)).rejects.toThrow('dneskai-media-unavailable');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ schemaVersion: 'dneskai-media/2', candidates: [] })));
    await expect(loadDneskaiMedia(project)).rejects.toThrow();
  });
});

it.each(['marketing_dneskai_candidates','marketing_media_collections','marketing_media_asset_links'])('does not present a missing %s result as an empty media tray',async nullTable=>{
 mocks.db.mockReturnValue(database({nullTable}).db);
 const response=await get(`?projectId=${project}`);expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'media-unavailable'});
});
