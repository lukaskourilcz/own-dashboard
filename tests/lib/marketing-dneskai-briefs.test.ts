import { describe, expect, it, vi } from 'vitest';
import { assignDneskaiBriefSlots, buildDneskaiBrief, createDneskaiBriefsWithStore, DneskaiBriefError, dneskaiBriefGenerationRequest, dneskaiBriefRepeat, dneskaiBriefSlots, dneskaiSitewidePictures, DNESKAI_BRIEF_SLOTS, type DneskaiBriefRow, type DneskaiBriefStore } from '@/lib/marketing/dneskai-briefs';
import { dneskaiBriefSourcePacket } from '@/lib/marketing/dneskai-brief-source';
import { parseSourcePacket } from '@/lib/marketing/contracts';
import { dneskaiEventId, dneskaiEventMemberHash } from '@/lib/marketing/dneskai-events';
import { GenerationInputSchema } from '@/lib/marketing/generation';
import type { DneskaiMediaAssetView, DneskaiMediaCandidateView } from '@/lib/marketing/dneskai-media-contracts';
import type { DneskaiCandidate } from '@/lib/marketing/dneskai-contracts';
import { runMarketingTick, type MarketingSchedulerPorts, type MarketingSchedulerStore } from '@/lib/marketing/scheduler';
import { MarketingWorkerRuntimeError } from '@/lib/marketing/worker-runtime';
import { syntheticCandidate } from './marketing-dneskai-briefs-db';
vi.mock('server-only', () => ({}));

// Synthetic, test-only reports, pictures and identifiers.
const owner = '11111111-1111-4111-8111-111111111111', project = '22222222-2222-4222-8222-222222222222', runId = '33333333-3333-4333-8333-333333333333';
const sha = (n: number) => n.toString(16).padStart(64, '0');
let assetIds = 0;
const asset = (n: number, position: number, size: { width: number; height: number } = { width: 1080, height: 1350 }, patch: Partial<DneskaiMediaAssetView> = {}): DneskaiMediaAssetView => ({
  assetId: `00000000-0000-4000-8000-${String(++assetIds).padStart(12, '0')}`, sha256: sha(n), position, originKind: position === 0 ? 'instagram-display' : 'instagram-child',
  originUrl: `https://scontent.cdninstagram.com/v/t51/${n}.jpg`, credit: 'Foto: @synthetic', ...size, mime: 'image/jpeg', bytes: 1000, fetchedAt: '2026-10-20T20:40:00Z',
  fullBleedCapable: Math.min(size.width, size.height) >= 900, insetCapable: size.width >= 600, duplicateOfAssetId: null, duplicateOfSha256: null, purged: false, previewUrl: null, ...patch,
});
const report = (sourceId: string, id: string, minutes: number, text?: string, patch: Partial<DneskaiCandidate> = {}) => syntheticCandidate(sourceId, id, `Synthetic event headline ${id}`,
  { status: 'selected', targetDate: '2026-10-21', category: 'ai-news', relevance: 0.9, publishedAt: new Date(Date.parse('2026-10-20T12:00:00Z') + minutes * 60000).toISOString(), ...patch }, text ?? `Synthetic excerpt ${id} `.repeat(30));

describe('DNESKAi brief slots (#115)', () => {
  it('uses 08:00, 12:30, 17:00 and 20:00 Europe/Prague, correct across the 25 October 2026 change', () => {
    expect(DNESKAI_BRIEF_SLOTS).toEqual(['08:00', '12:30', '17:00', '20:00']);
    expect(dneskaiBriefSlots('2026-10-24')).toEqual(['2026-10-24T06:00:00.000Z', '2026-10-24T10:30:00.000Z', '2026-10-24T15:00:00.000Z', '2026-10-24T18:00:00.000Z']);
    expect(dneskaiBriefSlots('2026-10-25')).toEqual(['2026-10-25T07:00:00.000Z', '2026-10-25T11:30:00.000Z', '2026-10-25T16:00:00.000Z', '2026-10-25T19:00:00.000Z']);
  });

  it('assigns in rank order, keeps an assigned slot and skips slots used by other posts of the day or too close to now', () => {
    const now = new Date('2026-10-24T20:30:00Z');
    const briefs = [{ id: 'third', rank: 3, scheduledAt: null }, { id: 'first', rank: 1, scheduledAt: null }, { id: 'second', rank: 2, scheduledAt: '2026-10-25T19:00:00.000Z' }, { id: 'fourth', rank: 4, scheduledAt: null }];
    const slots = assignDneskaiBriefSlots(briefs, '2026-10-25', ['2026-10-25T11:45:00.000Z'], now);
    expect(Object.fromEntries(slots)).toEqual({ first: '2026-10-25T07:00:00.000Z', second: '2026-10-25T19:00:00.000Z', third: '2026-10-25T16:00:00.000Z', fourth: null });
    const late = assignDneskaiBriefSlots([{ id: 'a', rank: 1, scheduledAt: null }], '2026-10-25', [], new Date('2026-10-25T06:45:00Z'));
    expect(late.get('a')).toBe('2026-10-25T11:30:00.000Z');
  });
});

describe('building a brief from an event', () => {
  const blog = report('openai-blog', 'blog', 0), crunch = report('techcrunch-ai', 'crunch', 30), reel = report('instagram:technology', 'reel', 60, 'Short synthetic caption', { url: 'https://www.instagram.com/reel/SYNTHETIC/', instagram: { mediaType: 'video' } });
  const base = { eventId: dneskaiEventId(blog.id), memberHash: dneskaiEventMemberHash([blog, crunch, reel]), targetDate: '2026-10-21', category: 'ai-news' as const, scheduledAt: '2026-10-21T06:00:00.000Z', observedAt: new Date('2026-10-20T20:45:00Z') };

  it('puts the original publisher first, carries captionOnly, keeps original picture order and caps media at twenty', () => {
    const outcome = buildDneskaiBrief({ ...base, members: [
      { candidate: reel, media: Array.from({ length: 10 }, (_, index) => asset(100 + index, index)) },
      { candidate: crunch, media: [asset(1, 1), asset(2, 0)] },
      { candidate: blog, media: Array.from({ length: 10 }, (_, index) => asset(200 + index, 9 - index)) },
    ] });
    if (!('brief' in outcome)) throw new Error(outcome.code);
    const brief = outcome.brief;
    // Publisher first; between two aggregators the one with more usable pictures leads.
    expect(brief.evidence.map((item) => item.candidateId)).toEqual([blog.id, reel.id, crunch.id]);
    expect(brief.evidence.map((item) => item.captionOnly)).toEqual([false, true, false]);
    expect(brief.media).toHaveLength(20);
    expect(brief.media.slice(0, 10).map((item) => [item.candidateId, item.position])).toEqual(Array.from({ length: 10 }, (_, index) => [blog.id, index]));
    expect(brief.media.slice(10).map((item) => item.assetSha256)).toEqual(Array.from({ length: 10 }, (_, index) => sha(100 + index)));
    expect(brief.media.some((item) => item.candidateId === crunch.id)).toBe(false);
    expect(brief).toMatchObject({ suggestedFormat: 'carousel', observedAt: '2026-10-20T20:45:00.000Z', expiresAt: '2026-10-22T20:45:00.000Z', title: blog.title });
  });

  it('suggests a single image for a short primary text with at most one usable picture, and lives 14 days for a tool', () => {
    const short = report('openai-blog', 'short', 0, 'Synthetic short announcement.');
    const outcome = buildDneskaiBrief({ ...base, category: 'tool', memberHash: dneskaiEventMemberHash([short]), members: [{ candidate: short, media: [asset(5, 0), asset(6, 1, { width: 320, height: 200 })] }] });
    if (!('brief' in outcome)) throw new Error(outcome.code);
    expect(outcome.brief).toMatchObject({ suggestedFormat: 'single-image', expiresAt: '2026-11-03T20:45:00.000Z' });
    expect(buildDneskaiBrief({ ...base, members: [{ candidate: report('openai-blog', 'long', 0), media: [] }] })).toMatchObject({ brief: { suggestedFormat: 'carousel', media: [] } });
  });

  it('offers no purged picture and never repeats one picture twice', () => {
    const outcome = buildDneskaiBrief({ ...base, members: [{ candidate: blog, media: [asset(7, 0, undefined, { purged: true }), asset(8, 1)] }, { candidate: crunch, media: [asset(8, 0)] }] });
    if (!('brief' in outcome)) throw new Error(outcome.code);
    expect(outcome.brief.media.map((item) => [item.assetSha256, item.candidateId])).toEqual([[sha(8), blog.id]]);
  });

  it('becomes a brief SourcePacket that parses, and refuses one that does not match its brief', () => {
    const outcome = buildDneskaiBrief({ ...base, members: [{ candidate: blog, media: [] }, { candidate: crunch, media: [] }] });
    if (!('brief' in outcome)) throw new Error(outcome.code);
    const packet = dneskaiBriefSourcePacket(outcome.brief);
    expect(packet).toMatchObject({ kind: 'brief', brand: 'dneskai', locale: 'cs', sourceId: base.eventId, sourceRevision: base.memberHash, canonicalUrl: blog.url, expiresAt: outcome.brief.expiresAt, eligible: true, content: { category: 'ai-news', image: null } });
    expect(packet.content.evidence.map((item) => [item.url, item.checkedAt])).toEqual([[blog.url, outcome.brief.observedAt], [crunch.url, outcome.brief.observedAt]]);
    expect(parseSourcePacket(packet)).toEqual(packet);
    for (const mutation of [{ sourceRevision: 'f'.repeat(64) }, { canonicalUrl: crunch.url }, { expiresAt: null }, { sourceId: 'other' }, { kind: 'article' as const }, { brand: 'devshark' as const, locale: 'en' as const }])
      expect(() => parseSourcePacket({ ...packet, ...mutation })).toThrow();
    expect(() => parseSourcePacket({ ...packet, content: { ...packet.content, evidence: [] } })).toThrow();
  });
});

describe('repetition against the last 14 days', () => {
  const brief = { evidence: [{ url: 'https://www.example.test/news/one?utm_source=x' }], media: [{ assetSha256: sha(1) }, { assetSha256: sha(2) }] } as Parameters<typeof dneskaiBriefRepeat>[0];
  it('matches canonical evidence URLs, identical pictures and recompressed copies, but not a template look-alike', () => {
    const phashes = new Map([[sha(2), '00000000000000ff'], [sha(3), '00000000000000f8'], [sha(4), '0000000000000f0f']]);
    expect(dneskaiBriefRepeat(brief, [{ id: 'r1', duplicateOf: 'r1', urls: ['https://example.test/news/one/'], assetSha256s: [] }], phashes)).toMatchObject({ by: 'url', coverage: { id: 'r1' } });
    expect(dneskaiBriefRepeat(brief, [{ id: 'r2', duplicateOf: 'r2', urls: [], assetSha256s: [sha(1)] }], phashes)).toMatchObject({ by: 'media' });
    expect(dneskaiBriefRepeat(brief, [{ id: 'r3', duplicateOf: 'r3', urls: [], assetSha256s: [sha(3)] }], phashes)).toMatchObject({ by: 'media' });
    expect(dneskaiBriefRepeat(brief, [{ id: 'r4', duplicateOf: 'r4', urls: ['https://example.test/news/two'], assetSha256s: [sha(4)] }], phashes)).toBeNull();
    // An ignored picture (a site-wide card) is not compared; the URLs still are.
    expect(dneskaiBriefRepeat(brief, [{ id: 'r2', duplicateOf: 'r2', urls: [], assetSha256s: [sha(1)] }], phashes, new Set([sha(1)]))).toBeNull();
    expect(dneskaiBriefRepeat(brief, [{ id: 'r1', duplicateOf: 'r1', urls: ['https://example.test/news/one/'], assetSha256s: [sha(1)] }], phashes, new Set([sha(1)]))).toMatchObject({ by: 'url' });
  });

  it('treats a picture three articles of one site carry as a site-wide card, not the same reports on three sites', () => {
    const arxiv = ['https://arxiv.org/abs/2610.00001', 'https://arxiv.org/abs/2610.00002v2', 'https://www.arxiv.org/abs/2610.00003?utm_source=x'].map((url) => ({ sha256: sha(1), url }));
    const story = ['https://www.theverge.com/news/1', 'https://techcrunch.com/2026/10/20/x', 'https://arstechnica.com/ai/x'].map((url) => ({ sha256: sha(2), url }));
    expect([...dneskaiSitewidePictures([...arxiv, ...story])]).toEqual([sha(1)]);
    // Two articles of one site, or one article listed twice, are not enough.
    expect(dneskaiSitewidePictures([...arxiv.slice(0, 2), { sha256: sha(1), url: 'https://arxiv.org/abs/2610.00001/' }]).size).toBe(0);
  });
});

type Calls = Array<[string, ...unknown[]]>;
function fakeStore(rows: DneskaiBriefRow[], members: DneskaiCandidate[], options: { owed?: string[]; account?: boolean; coverage?: Parameters<typeof dneskaiBriefRepeat>[1]; media?: Record<string, DneskaiMediaAssetView[]>; articles?: Array<{ sha256: string; url: string }> } = {}) {
  const calls: Calls = [];
  const requests: unknown[] = [];
  const store: DneskaiBriefStore = {
    run: async () => ({ id: runId, date: '2026-10-20', target_date: '2026-10-21', status: 'complete' }),
    briefs: async () => rows.map((row) => ({ ...row })),
    members: async (_owner, _project, ids) => members.filter((item) => ids.includes(item.id)).map((item) => ({ id: item.id, status: item.status, target_date: item.targetDate, content_hash: item.contentHash, candidate: item })),
    owedMedia: async (_owner, _project, ids) => new Set((options.owed ?? []).filter((id) => ids.includes(id))),
    media: async (_owner, _project, id) => ({ assets: options.media?.[id] ?? [] }) as unknown as DneskaiMediaCandidateView,
    coverage: async () => [...(options.coverage ?? [])],
    phashes: async () => new Map(),
    pictureArticles: async (_owner, _project, sha256s, exclude) => { calls.push(['pictureArticles', [...sha256s], [...exclude]]); return options.articles ?? []; },
    takenSlots: async () => [],
    account: async () => options.account ? { remote_account_id: '17840000000000000', handle: 'dneskai' } : null,
    prepare: async (_owner, id, brief, scheduledAt, status, code) => { calls.push(['prepare', id, status, code, scheduledAt]); const row = rows.find((item) => item.id === id)!; Object.assign(row, { status, code, ...(brief ? { brief, scheduled_at: scheduledAt } : {}) }); },
    skip: async (_owner, id, code, duplicateOf) => { calls.push(['skip', id, code, duplicateOf]); Object.assign(rows.find((item) => item.id === id)!, { status: 'skipped', code }); },
    ingest: async (_owner, packet) => { calls.push(['ingest', packet.sourceId]); return { id: '66666666-6666-4666-8666-666666666666' }; },
    admit: async (_owner, id) => { calls.push(['admit', id]); return { campaignId: '77777777-7777-4777-8777-777777777777', entryId: '88888888-8888-4888-8888-888888888888', entryVersion: 1 }; },
    enqueue: async (_owner, request) => { requests.push(request); return { jobId: '99999999-9999-4999-8999-999999999999', status: 'queued', duplicate: false }; },
    queued: async (_owner, id, jobId) => { calls.push(['queued', id, jobId]); Object.assign(rows.find((item) => item.id === id)!, { status: 'queued', job_id: jobId }); },
  };
  return { store, calls, requests };
}
const briefRow = (id: string, rank: number, items: DneskaiCandidate[], category: DneskaiBriefRow['category'] = 'ai-news'): DneskaiBriefRow => ({
  id, user_id: owner, project_id: project, run_id: runId, event_id: dneskaiEventId(items[0]!.id), target_date: '2026-10-21', rank, category, member_ids: items.map((item) => item.id),
  lead_candidate_id: items[0]!.id, member_hash: dneskaiEventMemberHash(items), status: 'pending', code: null, brief: null, scheduled_at: null, calendar_entry_id: null, job_id: null, created_at: '', updated_at: '',
});

describe('createDneskaiBriefs over a store', () => {
  const now = () => new Date('2026-10-20T21:00:00Z');
  const a1 = report('openai-blog', 'a1', 0), a2 = report('the-verge', 'a2', 10), b1 = report('hf-blog', 'b1', 20, undefined, { category: 'tool' });
  const ids = (brief: string, rank: number) => `${brief.padStart(8, '0')}-0000-4000-8000-00000000000${rank}`;

  it('waits while a member still owes media and builds nothing for that event', async () => {
    const rows = [briefRow(ids('a', 1), 1, [a1, a2]), briefRow(ids('b', 2), 2, [b1], 'tool')];
    const { store, calls } = fakeStore(rows, [a1, a2, b1], { owed: [a2.id], account: false });
    const result = await createDneskaiBriefsWithStore(store, { owner, project, runId }, { now });
    expect(result.pending).toBe(true);
    expect(result.created).toEqual([{ briefId: rows[1]!.id, eventId: rows[1]!.event_id, jobId: null }]);
    // The waiting event keeps the better slot; the second takes 12:30.
    expect(calls).toEqual([['prepare', rows[1]!.id, 'pending', 'account-unavailable', '2026-10-21T10:30:00.000Z']]);
  });

  it('holds a built brief as account-unavailable without a job, and a second call creates nothing new but keeps waiting', async () => {
    const rows = [briefRow(ids('a', 1), 1, [a1, a2])];
    const { store, calls } = fakeStore(rows, [a1, a2], { account: false });
    expect(await createDneskaiBriefsWithStore(store, { owner, project, runId }, { now })).toEqual({ created: [{ briefId: rows[0]!.id, eventId: rows[0]!.event_id, jobId: null }], skipped: [], pending: true });
    expect(rows[0]).toMatchObject({ status: 'pending', code: 'account-unavailable', scheduled_at: '2026-10-21T06:00:00.000Z' });
    expect(await createDneskaiBriefsWithStore(store, { owner, project, runId }, { now })).toEqual({ created: [], skipped: [], pending: true });
    expect(calls.filter(([name]) => name === 'enqueue' || name === 'admit')).toEqual([]);
  });

  it('admits a brief as one job whose request carries the brief SourcePacket, then never twice', async () => {
    const rows = [briefRow(ids('a', 1), 1, [a1, a2])];
    const { store, calls, requests } = fakeStore(rows, [a1, a2], { account: true, media: { [a1.id]: [asset(9, 0)] } });
    const result = await createDneskaiBriefsWithStore(store, { owner, project, runId }, { now });
    expect(result).toEqual({ created: [{ briefId: rows[0]!.id, eventId: rows[0]!.event_id, jobId: '99999999-9999-4999-8999-999999999999' }], skipped: [], pending: false });
    expect(calls.map(([name]) => name)).toEqual(['prepare', 'ingest', 'admit', 'queued']);
    const request = requests[0] as ReturnType<typeof dneskaiBriefGenerationRequest>;
    expect(request).toMatchObject({ schemaVersion: 'marketing-job/1', calendarEntryId: '88888888-8888-4888-8888-888888888888', calendarEntryVersion: 1,
      generation: { account: { platform: 'instagram', handle: 'dneskai' }, scheduledAt: '2026-10-21T06:00:00.000Z', consent: true, knowledge: [] } });
    expect(request).not.toHaveProperty('template');
    expect(request.idempotencyKey).toBe(request.generation.revisionId);
    expect(GenerationInputSchema.parse(request.generation)).toBeTruthy();
    const packet = parseSourcePacket(request.generation.source);
    expect(packet).toMatchObject({ kind: 'brief', sourceId: rows[0]!.event_id, sourceRevision: rows[0]!.member_hash, canonicalUrl: a1.url });
    expect(packet.brief?.media.map((item) => item.assetSha256)).toEqual([sha(9)]);
    expect(await createDneskaiBriefsWithStore(store, { owner, project, runId }, { now })).toEqual({ created: [], skipped: [], pending: false });
  });

  it('skips a repeat of recent coverage and marks its reports as duplicates of what covered it', async () => {
    const rows = [briefRow(ids('a', 1), 1, [a1, a2])];
    const { store, calls } = fakeStore(rows, [a1, a2], { account: true, coverage: [{ id: 'rev', duplicateOf: 'revision-1', urls: [a2.url], assetSha256s: [] }] });
    expect(await createDneskaiBriefsWithStore(store, { owner, project, runId }, { now })).toEqual({ created: [], skipped: [{ eventId: rows[0]!.event_id, code: 'collection-already-covered' }], pending: false });
    expect(calls).toEqual([['skip', rows[0]!.id, 'collection-already-covered', 'revision-1']]);
  });

  it('repeats on a recent post’s picture, but not on a site-wide card that other articles of the site carry', async () => {
    const coverage = [{ id: 'rev', duplicateOf: 'revision-1', urls: ['https://example.test/other-story'], assetSha256s: [sha(9)] }];
    const repeated = fakeStore([briefRow(ids('a', 1), 1, [a1, a2])], [a1, a2], { account: true, coverage, media: { [a1.id]: [asset(9, 0)] }, articles: [{ sha256: sha(9), url: 'https://openai.example.test/one' }] });
    expect((await createDneskaiBriefsWithStore(repeated.store, { owner, project, runId }, { now })).skipped).toEqual([{ eventId: dneskaiEventId(a1.id), code: 'collection-already-covered' }]);
    expect(repeated.calls.find(([name]) => name === 'pictureArticles')).toEqual(['pictureArticles', [sha(9)], [a1.id, a2.id]]);
    const card = fakeStore([briefRow(ids('a', 1), 1, [a1, a2])], [a1, a2], { account: true, coverage, media: { [a1.id]: [asset(9, 0)] },
      articles: ['one', 'two', 'three'].map((slug) => ({ sha256: sha(9), url: `https://openai.example.test/${slug}` })) });
    const result = await createDneskaiBriefsWithStore(card.store, { owner, project, runId }, { now });
    expect(result.skipped).toEqual([]);
    expect(result.created).toHaveLength(1);
  });

  it('leaves the slot of a skipped repeat to the next event', async () => {
    const rows = [briefRow(ids('a', 1), 1, [a1, a2]), briefRow(ids('b', 2), 2, [b1], 'tool')];
    const { store } = fakeStore(rows, [a1, a2, b1], { account: false, coverage: [{ id: 'rev', duplicateOf: 'revision-1', urls: [a1.url], assetSha256s: [] }] });
    const result = await createDneskaiBriefsWithStore(store, { owner, project, runId }, { now });
    expect(result.skipped).toEqual([{ eventId: rows[0]!.event_id, code: 'collection-already-covered' }]);
    expect(rows[1]).toMatchObject({ status: 'pending', code: 'account-unavailable', scheduled_at: '2026-10-21T06:00:00.000Z' });
  });

  it('skips an event whose members changed since selection, and closes a target day whose slots have passed', async () => {
    const changed = briefRow(ids('a', 1), 1, [a1, a2]);
    const { store, calls } = fakeStore([changed], [a1, { ...a2, status: 'duplicate' }], { account: true });
    await createDneskaiBriefsWithStore(store, { owner, project, runId }, { now });
    expect(calls).toEqual([['skip', changed.id, 'brief-members-changed', null]]);
    const late = fakeStore([briefRow(ids('b', 1), 1, [b1], 'tool')], [b1], { owed: [b1.id] });
    expect(await createDneskaiBriefsWithStore(late.store, { owner, project, runId }, { now: () => new Date('2026-10-21T19:00:00Z') })).toMatchObject({ skipped: [{ code: 'brief-target-date-passed' }], pending: false });
  });

  it('reports pending while the run is still collecting', async () => {
    const { store } = fakeStore([], []);
    store.run = async () => ({ id: runId, date: '2026-10-20', target_date: '2026-10-21', status: 'running' });
    expect(await createDneskaiBriefsWithStore(store, { owner, project, runId }, { now })).toEqual({ created: [], skipped: [], pending: true });
  });

  it.each([['job-budget-exhausted', true], ['marketing-consent-required', true], ['job-enqueue-failed', true], ['source-unavailable', false], ['template-revision-mismatch', false]] as const)(
    'stays pending after a %s admission failure only when it can pass (%s)', async (code, pending) => {
      const rows = [briefRow(ids('a', 1), 1, [a1, a2])];
      const { store } = fakeStore(rows, [a1, a2], { account: true });
      store.enqueue = async () => { throw new MarketingWorkerRuntimeError(code); };
      expect(await createDneskaiBriefsWithStore(store, { owner, project, runId }, { now })).toEqual({ created: [], skipped: [{ eventId: rows[0]!.event_id, code }], pending });
      expect(rows[0]).toMatchObject({ status: 'ready', code });
    });

  describe('under the five-minute scheduler tick', () => {
    /** The briefs step of runMarketingTick over this store; every other category has nothing to do. */
    function scheduled(store: DneskaiBriefStore, start: string) {
      const clock = { at: Date.parse(start) };
      const leases = new Map<string, Record<string, unknown>>();
      const schedulerStore: MarketingSchedulerStore = {
        beginTick: async () => true, finishTick: async () => true, saveState: async () => true, pruneTicks: async () => 0,
        acquire: async (lease) => ({ acquired: true, until: new Date(clock.at + 90_000).toISOString(), state: structuredClone(leases.get(lease) ?? {}) }),
        release: async (lease, _holder, update) => { if (update.state) leases.set(lease, structuredClone(update.state)); return true; },
      };
      const createBriefs = vi.fn((input: Parameters<MarketingSchedulerPorts['createBriefs']>[0]) => createDneskaiBriefsWithStore(store, input, { now: () => new Date(clock.at) }));
      const ports = {
        store: schedulerStore, dneskaiProject: async () => project, createBriefs, collectionRuns: async () => [{ id: runId, date: '2026-10-20', status: 'complete', pilot: false }],
        pendingMedia: async () => [], publicationWork: async () => false, nextReconciliation: async () => null, tokenMetadata: async () => [],
      } as unknown as MarketingSchedulerPorts;
      let ticks = 0;
      const tick = async () => {
        const result = await runMarketingTick({ owner, env: { MARKETING_DNESKAI_COLLECTION_ENABLED: 'true' }, ports, now: () => new Date(clock.at) }, { tick: `aaaaaaaa-aaaa-4aaa-8aaa-${String(++ticks).padStart(12, '0')}`, kind: 'minute' });
        clock.at += 5 * 60_000;
        return result.did.find((step) => step.category === 'briefs')!;
      };
      return { tick, createBriefs, clock };
    }

    it('admits a brief held for the account on the first tick after the owner verifies it', async () => {
      const rows = [briefRow(ids('a', 1), 1, [a1, a2])];
      const options = { account: false };
      const { store, requests } = fakeStore(rows, [a1, a2], options);
      const { tick, createBriefs } = scheduled(store, '2026-10-20T21:00:00Z');
      expect(await tick()).toMatchObject({ status: 'done', pending: true, detail: { created: 1, jobs: 0 } });
      expect(await tick()).toMatchObject({ status: 'noop', pending: true, detail: { created: 0 } });
      options.account = true;
      expect(await tick()).toMatchObject({ status: 'done', detail: { created: 1, jobs: 1 } });
      expect(rows[0]).toMatchObject({ status: 'queued', job_id: '99999999-9999-4999-8999-999999999999' });
      expect(await tick()).toMatchObject({ status: 'noop', code: 'briefs-current' });
      expect(requests).toHaveLength(1);
      expect(createBriefs).toHaveBeenCalledTimes(3);
    });

    it('does not admit a held brief whose slot is less than 30 minutes away when the account is verified', async () => {
      const rows = [briefRow(ids('a', 1), 1, [a1, a2])];
      const options = { account: false };
      const { store, requests, calls } = fakeStore(rows, [a1, a2], options);
      const { tick, clock } = scheduled(store, '2026-10-20T21:00:00Z');
      expect(await tick()).toMatchObject({ pending: true });
      expect(rows[0]).toMatchObject({ scheduled_at: '2026-10-21T06:00:00.000Z' });
      // 07:57 in Prague: three minutes before the brief's 08:00 slot.
      options.account = true;
      clock.at = Date.parse('2026-10-21T05:57:00Z');
      const late = await tick();
      expect(late).toMatchObject({ status: 'noop', detail: { created: 0, jobs: 0, skipped: 1 } });
      expect(late.pending).toBeUndefined();
      expect(rows[0]).toMatchObject({ status: 'skipped', code: 'brief-slot-passed' });
      expect(requests).toEqual([]);
      expect(calls.filter(([name]) => name === 'admit' || name === 'ingest')).toEqual([]);
    });

    it('builds a brief again on the next tick when storing it first failed in the store', async () => {
      const rows = [briefRow(ids('a', 1), 1, [a1, a2])];
      const { store, requests } = fakeStore(rows, [a1, a2], { account: true });
      const prepare = store.prepare;
      let failing = true;
      store.prepare = async (...args) => { if (failing) { failing = false; throw new DneskaiBriefError('brief-store-unavailable'); } return prepare(...args); };
      const { tick } = scheduled(store, '2026-10-20T21:00:00Z');
      expect(await tick()).toMatchObject({ status: 'noop', pending: true, detail: { created: 0, skipped: 1 } });
      expect(rows[0]).toMatchObject({ status: 'pending', brief: null });
      expect(await tick()).toMatchObject({ status: 'done', detail: { created: 1, jobs: 1 } });
      expect(rows[0]).toMatchObject({ status: 'queued', scheduled_at: '2026-10-21T06:00:00.000Z' });
      expect(await tick()).toMatchObject({ status: 'noop', code: 'briefs-current' });
      expect(requests).toHaveLength(1);
    });

    it('retries a job admission the daily budget refused on the next tick', async () => {
      const rows = [briefRow(ids('a', 1), 1, [a1, a2])];
      const { store, requests } = fakeStore(rows, [a1, a2], { account: true });
      const enqueue = store.enqueue;
      let refused = true;
      store.enqueue = async (who, request) => { if (refused) throw new MarketingWorkerRuntimeError('job-budget-exhausted'); return enqueue(who, request); };
      const { tick } = scheduled(store, '2026-10-20T21:00:00Z');
      expect(await tick()).toMatchObject({ status: 'noop', pending: true, detail: { created: 0, skipped: 1 } });
      expect(rows[0]).toMatchObject({ status: 'ready', code: 'job-budget-exhausted' });
      refused = false;
      expect(await tick()).toMatchObject({ status: 'done', detail: { created: 1, jobs: 1 } });
      expect(await tick()).toMatchObject({ status: 'noop', code: 'briefs-current' });
      expect(requests).toHaveLength(1);
    });

    it('stops calling once the target day has no slot left for a brief that never got its account', async () => {
      const rows = [briefRow(ids('a', 1), 1, [a1, a2])];
      const { store } = fakeStore(rows, [a1, a2], { account: false });
      const { tick, createBriefs, clock } = scheduled(store, '2026-10-20T21:00:00Z');
      expect(await tick()).toMatchObject({ pending: true });
      // 20:00 in Prague on the target day: the last slot is less than 30 minutes away.
      clock.at = Date.parse('2026-10-21T18:00:00Z');
      const closing = await tick();
      expect(closing).toMatchObject({ status: 'noop', detail: { skipped: 1 } });
      expect(closing.pending).toBeUndefined();
      expect(rows[0]).toMatchObject({ status: 'skipped', code: 'brief-target-date-passed' });
      expect(await tick()).toMatchObject({ status: 'noop', code: 'briefs-current' });
      expect(createBriefs).toHaveBeenCalledTimes(2);
    });
  });
});

describe('other events for the Sources tab', () => {
  it('groups unselected reports into one held or duplicate event each, primary first, without the briefed ones', async () => {
    const { dneskaiOtherEventViews } = await import('@/lib/marketing/dneskai-brief-read');
    const a = syntheticCandidate('techcrunch-ai', 'o1', 'Synthetic robot dog learns to open doors', { status: 'duplicate', reason: 'collection-already-covered', fetchedAt: '2026-10-20T20:00:00Z' });
    const b = syntheticCandidate('mit-tech-review', 'o2', 'Synthetic robot dog learns to open doors', { status: 'new', fetchedAt: '2026-10-20T20:05:00Z' });
    const c = syntheticCandidate('wired-ai', 'o3', 'Synthetic satellite outage explained', { status: 'held', reason: 'collection-review-relevance', fetchedAt: '2026-10-20T19:00:00Z' });
    const briefed = syntheticCandidate('openai-blog', 'o4', 'Synthetic launch already briefed', { status: 'new' });
    const views = dneskaiOtherEventViews([a, b, c, briefed], new Set([briefed.id]));
    expect(views.map((view) => [view.status, view.reason, view.members.map((member) => [member.candidateId, member.role])])).toEqual([
      ['duplicate', 'collection-already-covered', [[b.id, 'primary'], [a.id, 'supporting']]],
      ['held', 'collection-review-relevance', [[c.id, 'primary']]],
    ]);
  });
});


describe('brief/2 evidence with v1 compatibility',()=>{
 it('carries source prose and image descriptions into the brief, packet and model offer',async()=>{
  const candidate=report('openai-blog','rich-page',0,'Short feed text.');
  const articleText='Richer public article evidence. '.repeat(30);
  const outcome=buildDneskaiBrief({eventId:dneskaiEventId(candidate.id),memberHash:dneskaiEventMemberHash([candidate]),targetDate:'2026-10-21',category:'ai-news',scheduledAt:'2026-10-21T06:00:00Z',observedAt:new Date('2026-10-20T20:30:00Z'),members:[{candidate,articleText,media:[asset(19,0,undefined,{sourceAltText:'A source description.'})]}]});
  if(!('brief' in outcome))throw new Error(outcome.code);
  expect(outcome.brief).toMatchObject({schemaVersion:'dneskai-brief/2',suggestedFormat:'carousel',evidence:[{articleText}],media:[{sourceAltText:'A source description.'}]});
  const packet=dneskaiBriefSourcePacket(outcome.brief);expect(packet.content.body).toContain(articleText.trim());
  const {dneskaiBriefOffer,dneskaiBriefPrompt}=await import('@/lib/marketing/dneskai-generation');
  const offer=dneskaiBriefOffer(outcome.brief,['Test publisher']);expect(offer.evidence[0]!.excerpt).toContain('Richer public article evidence.');
  expect(JSON.parse(dneskaiBriefPrompt(offer)).media[0].sourceAltText).toBe('A source description.');
  const {DneskaiBriefSchema}=await import('@/lib/marketing/dneskai-brief');
  const legacy={...outcome.brief,schemaVersion:'dneskai-brief/1',evidence:outcome.brief.evidence.map(({...e})=>{delete (e as {articleText?:string}).articleText;return e;}),media:outcome.brief.media.map(({...m})=>{delete (m as {sourceAltText?:string}).sourceAltText;return m;})};
  expect(DneskaiBriefSchema.safeParse(legacy).success).toBe(true);
  expect(DneskaiBriefSchema.safeParse({...legacy,evidence:outcome.brief.evidence}).success).toBe(false);
 });
 it('never turns a caption-only source into article prose',()=>{
  const candidate=report('instagram:technology','caption-only',0,'Short caption',{url:'https://www.instagram.com/reel/SYNTHETIC/',instagram:{mediaType:'video'}});
  const result=buildDneskaiBrief({eventId:dneskaiEventId(candidate.id),memberHash:dneskaiEventMemberHash([candidate]),targetDate:'2026-10-21',category:'ai-news',scheduledAt:'2026-10-21T06:00:00Z',observedAt:new Date('2026-10-20T20:30:00Z'),members:[{candidate,articleText:'Not a transcript. '.repeat(100),media:[]}]});
  expect(result).toMatchObject({brief:{evidence:[{captionOnly:true,excerpt:'Short caption'}]}});
  if('brief' in result)expect(result.brief.evidence[0]).not.toHaveProperty('articleText');
 });
});


it('builds a strict brief/1 without rich fields for an unmigrated production writer', () => {
  const candidate = report('openai-blog', 'legacy-writer', 0, 'Short feed text.');
  const outcome = buildDneskaiBrief({ eventId: dneskaiEventId(candidate.id), memberHash: dneskaiEventMemberHash([candidate]), targetDate: '2026-10-21', category: 'ai-news', scheduledAt: '2026-10-21T06:00:00Z', observedAt: new Date('2026-10-20T20:30:00Z'), richEvidence: false,
    members: [{ candidate, articleText: 'Full article prose. '.repeat(60), media: [asset(20, 0, undefined, { sourceAltText: 'Source image description.' })] }] });
  expect(outcome).toMatchObject({ brief: { schemaVersion: 'dneskai-brief/1', suggestedFormat: 'single-image' } });
  if (!('brief' in outcome)) throw new Error(outcome.code);
  expect(outcome.brief.evidence[0]).not.toHaveProperty('articleText');
  expect(outcome.brief.media[0]).not.toHaveProperty('sourceAltText');
});
