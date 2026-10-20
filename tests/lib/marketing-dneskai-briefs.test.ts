import { describe, expect, it, vi } from 'vitest';
import { assignDneskaiBriefSlots, buildDneskaiBrief, createDneskaiBriefsWithStore, dneskaiBriefJobRequest, dneskaiBriefRepeat, dneskaiBriefSlots, DNESKAI_BRIEF_SLOTS, type DneskaiBriefRow, type DneskaiBriefStore } from '@/lib/marketing/dneskai-briefs';
import { dneskaiBriefSourcePacket } from '@/lib/marketing/dneskai-brief-source';
import { parseSourcePacket } from '@/lib/marketing/contracts';
import { dneskaiEventId, dneskaiEventMemberHash } from '@/lib/marketing/dneskai-events';
import { GenerationInputSchema } from '@/lib/marketing/generation';
import type { DneskaiMediaAssetView, DneskaiMediaCandidateView } from '@/lib/marketing/dneskai-media-contracts';
import type { DneskaiCandidate } from '@/lib/marketing/dneskai-contracts';
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
  });
});

type Calls = Array<[string, ...unknown[]]>;
function fakeStore(rows: DneskaiBriefRow[], members: DneskaiCandidate[], options: { owed?: string[]; account?: boolean; coverage?: Parameters<typeof dneskaiBriefRepeat>[1]; media?: Record<string, DneskaiMediaAssetView[]> } = {}) {
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
    takenSlots: async () => [],
    account: async () => options.account ? { remote_account_id: '17840000000000000', handle: 'dneskai' } : null,
    knowledge: async () => [],
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

  it('holds a built brief as account-unavailable without a job, and a second call creates nothing new', async () => {
    const rows = [briefRow(ids('a', 1), 1, [a1, a2])];
    const { store, calls } = fakeStore(rows, [a1, a2], { account: false });
    expect(await createDneskaiBriefsWithStore(store, { owner, project, runId }, { now })).toEqual({ created: [{ briefId: rows[0]!.id, eventId: rows[0]!.event_id, jobId: null }], skipped: [], pending: false });
    expect(rows[0]).toMatchObject({ status: 'pending', code: 'account-unavailable', scheduled_at: '2026-10-21T06:00:00.000Z' });
    expect(await createDneskaiBriefsWithStore(store, { owner, project, runId }, { now })).toEqual({ created: [], skipped: [], pending: false });
    expect(calls.filter(([name]) => name === 'enqueue' || name === 'admit')).toEqual([]);
  });

  it('admits a brief as one job whose request carries the brief SourcePacket, then never twice', async () => {
    const rows = [briefRow(ids('a', 1), 1, [a1, a2])];
    const { store, calls, requests } = fakeStore(rows, [a1, a2], { account: true, media: { [a1.id]: [asset(9, 0)] } });
    const result = await createDneskaiBriefsWithStore(store, { owner, project, runId }, { now });
    expect(result).toEqual({ created: [{ briefId: rows[0]!.id, eventId: rows[0]!.event_id, jobId: '99999999-9999-4999-8999-999999999999' }], skipped: [], pending: false });
    expect(calls.map(([name]) => name)).toEqual(['prepare', 'ingest', 'admit', 'queued']);
    const request = requests[0] as ReturnType<typeof dneskaiBriefJobRequest>;
    expect(request).toMatchObject({ schemaVersion: 'marketing-job/1', calendarEntryId: '88888888-8888-4888-8888-888888888888', calendarEntryVersion: 1,
      generation: { account: { platform: 'instagram', handle: 'dneskai' }, scheduledAt: '2026-10-21T06:00:00.000Z', consent: true } });
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
});
