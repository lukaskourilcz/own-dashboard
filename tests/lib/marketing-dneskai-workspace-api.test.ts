import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), tables: {} as Record<string, Array<Record<string, unknown>>>, fail: null as string | null, filters: [] as Array<[string, string, string, unknown]>, rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.user }, from: table(mocks) }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
import { GET as review } from '@/app/api/marketing/dneskai/review/route';
import { GET as costs } from '@/app/api/marketing/dneskai/costs/route';
import { DneskaiCostsReadSchema, DneskaiWorkspaceReadSchema, dneskaiPostState, dneskaiStateContext } from '@/lib/marketing/dneskai-workspace';
import { dneskaiSlideFieldLimits } from '@/lib/marketing/dneskai-workspace-read';
import { MARKETING_DECK_CONTENT_VERSION } from '@/lib/marketing/contracts';
import { DNESKAI_SLIDES_VERSION } from '@/lib/marketing/dneskai-slides';
import { pragueScheduledAt } from '@/lib/marketing/clock';
import { pragueMarketingDate } from '@/lib/marketing/weekly-planning';

function table(state: typeof mocks) {
  return (name: string) => {
    let rows = [...(state.tables[name] ?? [])];
    let limit = Infinity;
    const query = {
      select: () => query,
      eq: (field: string, value: unknown) => { state.filters.push([name, 'eq', field, value]); rows = rows.filter((row) => !(field in row) || row[field] === value); return query; },
      neq: (field: string, value: unknown) => { rows = rows.filter((row) => row[field] !== value); return query; },
      in: (field: string, values: unknown[]) => { rows = rows.filter((row) => !(field in row) || values.includes(row[field])); return query; },
      gte: () => query, order: () => query,
      limit: (count: number) => { limit = count; return query; },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(state.fail === name ? { data: null, error: { message: 'PRIVATE database detail' } } : { data: rows.slice(0, limit), error: null }).then(resolve, reject),
    };
    return query;
  };
}

const owner = '11111111-1111-4111-8111-111111111111';
const project = '22222222-2222-4222-8222-222222222222';
const revisionId = '33333333-3333-4333-8333-333333333333';
const sha = (n: number) => n.toString(16).padStart(64, '0');
const eventId = sha(900);
const tomorrow = new Date(Date.parse(`${pragueMarketingDate(new Date())}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const scheduledAt = pragueScheduledAt(tomorrow, '08:00');
const deck = { schemaVersion: DNESKAI_SLIDES_VERSION, format: 'carousel', slides: [
  { type: 'cover-photo', headline: 'Smyšlený titulek', kicker: 'TÉMA', credit: 'Foto: smyšlený zdroj', images: [{ slot: 'image-1', assetSha256: sha(1) }], alt: 'Smyšlená fotka' },
  { type: 'statement', headline: 'Smyšlený výrok', body: 'Poznámka.', images: [], alt: 'Výrok' },
  { type: 'sources', headline: '', sources: ['Smyšlený zdroj (21. 10. 2026)'], images: [{ slot: 'image-1', assetSha256: sha(1) }], alt: 'Zdroje' },
] };
const revision = { schemaVersion: MARKETING_DECK_CONTENT_VERSION, brand: 'dneskai', title: 'Smyšlený příspěvek', caption: 'Smyšlený popisek.', format: 'carousel',
  sources: [{ sourceId: eventId, sourceRevision: sha(901), contentHash: sha(902) }], knowledgeIds: [],
  assets: [1, 2, 3].map((n) => ({ url: `https://example.supabase.co/storage/v1/object/sign/marketing-assets/${owner}/marketing/dneskai/slides/${sha(n + 10)}.jpg?token=TEST`, sha256: sha(n + 20), mimeType: 'image/jpeg', width: 1080, height: 1350, alt: `Slide ${n}` })),
  account: { id: '17841400000000000', platform: 'instagram', handle: 'dneskai' }, scheduledAt, timeZone: 'Europe/Prague', templateVersion: 'carousel-studio/1.0.0+852c2e9',
  promptVersion: 'marketing-copy/5', model: 'claude-sonnet-5-5', traceId: null, deck };
const brief = { schemaVersion: 'dneskai-brief/1', eventId, memberHash: sha(901), targetDate: tomorrow, category: 'ai-news', title: 'Smyšlené téma',
  evidence: [{ candidateId: 'c1', sourceId: 'the-verge', url: 'https://example.com/a', title: 'Smyšlený článek', excerpt: 'Text.', publishedAt: null, dateEstimated: false, captionOnly: false }],
  media: [{ assetSha256: sha(1), candidateId: 'c1', position: 0, credit: 'Foto: smyšlený zdroj', width: 1600, height: 1200, originKind: 'og-image', fullBleedCapable: true, insetCapable: true }],
  suggestedFormat: 'carousel', scheduledAt, timeZone: 'Europe/Prague', observedAt: '2026-10-20T20:00:00.000Z', expiresAt: '2099-10-22T20:00:00.000Z' };

beforeEach(() => {
  mocks.user.mockResolvedValue({ data: { user: { id: owner } } }); mocks.fail = null; mocks.filters = []; mocks.rpc.mockReset();
  mocks.tables = {
    projects: [{ id: project, user_id: owner, portfolio_key: 'aifirst', repo_full_name: null, previous_repo_full_names: [], parent_id: null }],
    marketing_revisions: [
      { id: revisionId, user_id: owner, brand: 'dneskai', replaces_id: null, status: 'review', ready: true, content_hash: sha(500), created_at: '2026-10-20T21:00:00Z', approved_at: null, feedback: null, revision,
        render_report: { schemaVersion: 'dneskai-render-report/1', status: 'rendered', problems: [{ slide: 1, code: 'image-upscaled', blocking: false, message: 'advisory', field: 'image-1' }], renderKeys: [], renderedAt: '2026-10-20T21:00:00Z' } },
      { id: '44444444-4444-4444-8444-444444444444', user_id: owner, brand: 'dneskai', replaces_id: null, status: 'review', ready: false, content_hash: sha(501), created_at: '2026-10-20T21:00:00Z', approved_at: null, feedback: null, revision: { broken: 'PRIVATE' }, render_report: null },
    ],
    marketing_accounts: [{ id: '55555555-5555-4555-8555-555555555555', user_id: owner, brand: 'dneskai', platform: 'instagram', remote_account_id: '17841400000000000', handle: '@dneskai', verified_at: '2026-10-20T10:00:00Z', enabled: false }],
    marketing_jobs: [{ id: '66666666-6666-4666-8666-666666666666', user_id: owner, status: 'running', error_code: null, created_at: '2026-10-20T21:30:00Z', title: 'Druhé smyšlené téma', scheduled_at: pragueScheduledAt(tomorrow, '12:30'), revision_id: '77777777-7777-4777-8777-777777777777', brand: 'dneskai', cost_usd: null },
      { id: '88888888-8888-4888-8888-888888888888', user_id: owner, status: 'failed', error_code: 'dneskai-daily-generation-budget-exhausted', created_at: new Date().toISOString(), title: 'Třetí téma', scheduled_at: pragueScheduledAt(tomorrow, '17:00'), revision_id: null, brand: 'dneskai', cost_usd: '0.25' }],
    marketing_publications: [],
    marketing_events: [],
    marketing_dneskai_briefs: [{ user_id: owner, event_id: eventId, member_hash: sha(901), status: 'queued', brief }],
    marketing_dneskai_runs: [{ id: '99999999-9999-4999-8999-999999999999', user_id: owner, project_id: project, date: pragueMarketingDate(new Date()), target_date: tomorrow, status: 'complete', cost_usd: '0.04', error_code: null, created_at: new Date().toISOString() }],
    marketing_ticks: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: owner, kind: 'minute', started_at: new Date().toISOString(), finished_at: new Date().toISOString(), did: [{ category: 'publishing', status: 'done', ms: 10 }], errors: [{ category: 'token', code: 'Bearer PRIVATE' }] },
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', user_id: owner, kind: 'minute', started_at: new Date().toISOString(), finished_at: null, did: [{ category: 'collection', status: 'skipped', code: 'collection-disabled', ms: 1 }], errors: [] }],
  };
});
const get = (route: typeof review, query: string) => route(new Request(`https://own.example/api/marketing/dneskai/x?${query}`));

describe('GET /api/marketing/dneskai/review (#119)', () => {
  it('returns the owner-scoped workspace with deck, fields, brief media and drafting jobs, and counts an unreadable row', async () => {
    const response = await get(review, `projectId=${project}`); const body = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    const read = DneskaiWorkspaceReadSchema.parse(body);
    expect(read.posts).toHaveLength(1); expect(read.unreadable).toBe(1);
    const [post] = read.posts;
    expect(post).toMatchObject({ id: revisionId, contentHash: sha(500), title: 'Smyšlený příspěvek', brief: { eventId, media: [{ assetSha256: sha(1), credit: 'Foto: smyšlený zdroj' }] } });
    expect(post!.fields).toEqual([[{ field: 'headline', max: 110 }, { field: 'kicker', max: 56 }, { field: 'credit', max: 80 }], [{ field: 'headline', max: 170 }, { field: 'body', max: 240 }], []]);
    expect(post!.renderReport?.problems[0]).toMatchObject({ field: 'image-1', blocking: false });
    expect(dneskaiPostState(post!, dneskaiStateContext(read)).state).toBe('review');
    expect(read.jobs.map((job) => [job.status, job.errorCode])).toEqual([['running', null], ['failed', 'dneskai-daily-generation-budget-exhausted']]);
    expect(read.accounts).toEqual([{ id: '55555555-5555-4555-8555-555555555555', remoteId: '17841400000000000', handle: 'dneskai', verified: true, enabled: false }]);
    expect(read.slots).toEqual(['08:00', '12:30', '17:00', '20:00']);
    expect(JSON.stringify(body)).not.toContain('PRIVATE');
    expect(mocks.filters.filter(([, op, field]) => op === 'eq' && field === 'user_id').every(([, , , value]) => value === owner)).toBe(true);
  });
  it('counts a malformed account row instead of failing the whole read', async () => {
    mocks.tables.marketing_accounts = [...mocks.tables.marketing_accounts!, { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', user_id: owner, brand: 'dneskai', platform: 'instagram', remote_account_id: '1', handle: '@', verified_at: null, enabled: false }];
    const response = await get(review, `projectId=${project}`);
    expect(response.status).toBe(200);
    const read = DneskaiWorkspaceReadSchema.parse(await response.json());
    expect(read.accounts.map((account) => account.handle)).toEqual(['dneskai']);
    expect(read.unreadable).toBe(2);
  });
  it('keeps every undecided post when newer receipts would fill the 60-post bound', async () => {
    const yesterday = pragueScheduledAt(new Date(Date.parse(`${pragueMarketingDate(new Date())}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10), '08:00');
    const receipts = Array.from({ length: 70 }, (_, n) => ({ ...mocks.tables.marketing_revisions![0]!, id: `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, '0')}`, status: 'published',
      content_hash: sha(600 + n), created_at: '2026-10-21T08:00:00Z', revision: { ...revision, scheduledAt: yesterday } }));
    mocks.tables.marketing_revisions = [...receipts, ...mocks.tables.marketing_revisions!];
    const read = DneskaiWorkspaceReadSchema.parse(await (await get(review, `projectId=${project}`)).json());
    expect(read.posts).toHaveLength(60);
    expect(read.posts[0]!.id).toBe(revisionId);
    expect(read.posts.filter((post) => post.status === 'published')).toHaveLength(59);
  });
  it('refuses a signed-out read, a bad project or date, a foreign project and hides database errors', async () => {
    mocks.user.mockResolvedValueOnce({ data: { user: null } });
    expect((await get(review, `projectId=${project}`)).status).toBe(401);
    expect((await get(review, 'projectId=nope')).status).toBe(400);
    expect((await get(review, `projectId=${project}&date=2020-01-01`)).status).toBe(400);
    mocks.tables.projects = [];
    expect((await get(review, `projectId=${project}`)).status).toBe(404);
    mocks.tables.projects = [{ id: project, user_id: owner, portfolio_key: 'aifirst', repo_full_name: null, previous_repo_full_names: [], parent_id: null }];
    mocks.fail = 'marketing_revisions';
    const failed = await get(review, `projectId=${project}`);
    expect(failed.status).toBe(503); expect(await failed.text()).not.toContain('PRIVATE');
  });
});

describe('GET /api/marketing/dneskai/costs (#119)', () => {
  it('reports runs, failed jobs, ticks and the 24-hour spend against the ceiling without free text', async () => {
    mocks.rpc.mockResolvedValue({ data: 0.5, error: null });
    const response = await get(costs, `projectId=${project}`); const read = DneskaiCostsReadSchema.parse(await response.json());
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('marketing_dneskai_generation_spent', { p_owner: owner });
    expect(read.generation).toEqual({ spentUsd: 0.5, ceilingUsd: 1, code: null });
    expect(read.runs[0]).toMatchObject({ status: 'complete', costUsd: 0.04 });
    expect(read.jobs.map((job) => job.errorCode)).toEqual(['dneskai-daily-generation-budget-exhausted']);
    // cost-16: the failed job's $0.25 is booked, not measured spend.
    expect(read.days[0]).toMatchObject({ collectionUsd: 0.04, generationUsd: 0, generationBookedUsd: 0.25 });
    expect(read.ticks).toMatchObject({ total: 2, withErrors: 1 });
    expect(read.ticks.recent[0]?.errors).toEqual([{ category: 'token', code: 'token-failed' }]);
    expect(JSON.stringify(read)).not.toContain('PRIVATE');
    expect(read.days).toHaveLength(7);
    const short = DneskaiCostsReadSchema.parse(await (await get(costs, `projectId=${project}&range=2d`)).json());
    expect(short.days.map((day) => day.date)).toEqual(read.days.slice(0, 2).map((day) => day.date));
    for (const range of ['8d', '0d', '7', 'week']) expect((await get(costs, `projectId=${project}&range=${range}`)).status).toBe(400);
  });
  it('keeps measured drafting cost, booked failed-job cost and unknown figures apart (cost-16)', async () => {
    mocks.rpc.mockResolvedValue({ data: 0.5, error: null });
    const now = new Date().toISOString();
    const job = (n: number, status: string, cost: string | null) => ({ id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`, user_id: owner, status, error_code: status === 'failed' ? 'provider-unavailable' : null, created_at: now, title: `Téma ${n}`, scheduled_at: pragueScheduledAt(tomorrow, '08:00'), revision_id: null, brand: 'dneskai', cost_usd: cost });
    mocks.tables.marketing_jobs = [job(1, 'review', '0.031'), job(2, 'review', '0.044'), job(3, 'failed', '0.25'), job(4, 'reconciliation', null), job(5, 'running', null)];
    mocks.tables.marketing_dneskai_runs = [{ id: '99999999-9999-4999-8999-999999999999', user_id: owner, project_id: project, date: pragueMarketingDate(new Date()), target_date: tomorrow, status: 'running', cost_usd: '0', error_code: null, created_at: now }];
    const read = DneskaiCostsReadSchema.parse(await (await get(costs, `projectId=${project}`)).json());
    expect(read.days[0]!.generationUsd).toBeCloseTo(0.075, 6);
    expect(read.days[0]).toMatchObject({ collectionUsd: 0, generationBookedUsd: 0.25, unknown: 3 });
    // A running collection run has a placeholder 0 until it finishes: it shows as not recorded.
    expect(read.runs[0]).toMatchObject({ status: 'running', costUsd: null });
  });
  it('counts a malformed run or tick instead of failing the whole read', async () => {
    mocks.rpc.mockResolvedValue({ data: 0.5, error: null });
    mocks.tables.marketing_dneskai_runs = [...mocks.tables.marketing_dneskai_runs!, { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', user_id: owner, project_id: project, date: pragueMarketingDate(new Date()), target_date: tomorrow, status: 'complete', cost_usd: '0.04', error_code: null, created_at: 'not a time' }];
    mocks.tables.marketing_ticks = [...mocks.tables.marketing_ticks!, { id: 'not-a-uuid', user_id: owner, kind: 'minute', started_at: new Date().toISOString(), finished_at: null, did: [], errors: [] }];
    const response = await get(costs, `projectId=${project}`);
    expect(response.status).toBe(200);
    const read = DneskaiCostsReadSchema.parse(await response.json());
    expect(read.runs).toHaveLength(1);
    expect(read.ticks.total).toBe(2);
    expect(read.unreadable).toBe(2);
  });
  it('shows an unreadable spend and a malformed ceiling as codes, not as zero', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'PRIVATE' } });
    vi.stubEnv('MARKETING_DNESKAI_DAILY_GENERATION_USD', 'lots');
    const read = DneskaiCostsReadSchema.parse(await (await get(costs, `projectId=${project}`)).json());
    expect(read.generation).toEqual({ spentUsd: null, ceilingUsd: null, code: 'dneskai-daily-generation-budget-invalid' });
    vi.unstubAllEnvs();
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'PRIVATE' } });
    const second = DneskaiCostsReadSchema.parse(await (await get(costs, `projectId=${project}`)).json());
    expect(second.generation).toEqual({ spentUsd: null, ceilingUsd: 1, code: 'dneskai-daily-generation-budget-unavailable' });
  });
});

describe('slide field limits', () => {
  it('lists only the fields each template draws, with its layer limit', () => {
    expect(dneskaiSlideFieldLimits({ type: 'split', headline: 'x', images: [{ slot: 'image-1', assetSha256: sha(1) }, { slot: 'image-2', assetSha256: sha(2) }], alt: 'x' }))
      .toEqual([{ field: 'headline', max: 110 }, { field: 'body', max: 320 }, { field: 'kicker', max: 28 }, { field: 'credit', max: 80 }]);
    expect(dneskaiSlideFieldLimits({ type: 'single', variant: 'photo', headline: 'x', images: [{ slot: 'image-1', assetSha256: sha(1) }], alt: 'x' }))
      .toEqual([{ field: 'headline', max: 110 }, { field: 'body', max: 100 }, { field: 'kicker', max: 44 }, { field: 'credit', max: 30 }]);
    expect(dneskaiSlideFieldLimits({ type: 'figure', headline: 'x', images: [{ slot: 'image-1', assetSha256: sha(1) }], alt: 'x' }).map((item) => item.field)).toEqual(['headline', 'body', 'credit']);
  });
});
