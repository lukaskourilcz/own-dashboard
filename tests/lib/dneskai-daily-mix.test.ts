import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), project: vi.fn(), maybeSingle: vi.fn(), rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.user }, from: () => {
  const builder: Record<string, unknown> = {}; for (const m of ['select', 'eq', 'maybeSingle', 'retry', 'abortSignal']) builder[m] = () => builder; builder.then = (resolve: (value: unknown) => unknown) => mocks.maybeSingle().then(resolve); return builder;
}, rpc: (...args: unknown[]) => { const b = { retry: () => b, abortSignal: () => b, then: (resolve: (value: unknown) => unknown) => mocks.rpc(...args).then(resolve) }; return b; } }) }));
vi.mock('@/lib/marketing/dneskai-store', () => ({ requireDneskaiProject: mocks.project }));
import { GET, PUT } from '@/app/api/marketing/dneskai/daily-mix/route';
import { DEFAULT_DNESKAI_DAILY_MIX, DneskaiDailyMixSchema, dneskaiActiveSlotTimes, dneskaiNewsTopicLimit } from '@/lib/marketing/dneskai-daily-mix';
import { dneskaiFreeSlots } from '@/lib/marketing/dneskai-briefs';
import { advanceDneskaiTopicBriefs, dneskaiTopicTargetDate, type DneskaiBridgeTopic, type DneskaiTopicBridgeStore } from '@/lib/marketing/dneskai-topic-bridge';
import type { DneskaiBriefStore } from '@/lib/marketing/dneskai-briefs';
import { dneskaiNewsTopicsFromRun } from '@/lib/marketing/dneskai-titling';

const owner = '11111111-1111-4111-8111-111111111111', project = '22222222-2222-4222-8222-222222222222';
const url = `https://own.example/api/marketing/dneskai/daily-mix?projectId=${project}`;
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('DNESKAI_DAILY_MIX_ENABLED', 'true'); vi.stubEnv('DNESKAI_TOPICS_ENABLED', 'true');
  mocks.user.mockResolvedValue({ data: { user: { id: owner } } }); mocks.project.mockResolvedValue({ id: project }); mocks.maybeSingle.mockResolvedValue({ data: null, error: null }); mocks.rpc.mockImplementation(async (_name: string, args: {p_mix: unknown}) => ({ data: {kind:'saved',projectId:project,ownerId:owner,sourceVersion:null,read:{mix:args.p_mix,stored:true,version:'2026-10-24T17:10:00.123456Z'}},error:null })); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('daily mix (#156)', () => {
  it('keeps a stored zero-post mix and fails closed on unreadable or malformed settings', async () => {
    mocks.maybeSingle.mockResolvedValue({ data:{news_per_day:0,education_per_day:0,slots:['08:00'],updated_at:'2026-10-24T17:10:00.123456Z'},error:null });
    expect(await (await GET(new Request(url))).json()).toEqual({mix:{newsPerDay:0,educationPerDay:0,slots:['08:00']},stored:true,version:'2026-10-24T17:10:00.123456Z'});
    mocks.maybeSingle.mockResolvedValue({data:null,error:{message:'synthetic private database error'}});
    const failed=await GET(new Request(url));expect(failed.status).toBe(503);expect(await failed.json()).toEqual({error:'daily-mix-unavailable'});
    mocks.maybeSingle.mockResolvedValue({data:{news_per_day:0,education_per_day:0,slots:['09:00'],updated_at:'2026-10-24T17:10:00Z'},error:null});
    expect((await GET(new Request(url))).status).toBe(503);
  });
  it('does not acknowledge foreign receipts, changed values or an empty RPC result', async () => {
    const mix={newsPerDay:0,educationPerDay:0,slots:['08:00']};
    for(const data of [null,{kind:'saved',ownerId:project,projectId:project,sourceVersion:null,read:{mix,stored:true,version:'2026-10-24T17:10:00Z'}},
      {kind:'saved',ownerId:owner,projectId:project,sourceVersion:null,read:{mix:{...mix,newsPerDay:1},stored:true,version:'2026-10-24T17:10:00Z'}}]) {
      mocks.rpc.mockResolvedValue({data,error:null});
      const result=await PUT(new Request(url,{method:'PUT',headers:{Origin:'https://own.example'},body:JSON.stringify({mix,expectedVersion:null})}));
      expect(result.status).toBe(503);expect(await result.json()).toEqual({error:'daily-mix-unavailable'});
    }
  });
  it('returns a validated version conflict rather than reporting a successful save', async () => {
    const mix={newsPerDay:0,educationPerDay:0,slots:['08:00']},version='2026-10-24T17:10:00.123456Z';
    const receipt={kind:'conflict',ownerId:owner,projectId:project,sourceVersion:version,read:{mix:{...mix,newsPerDay:1},stored:true,version}};
    mocks.rpc.mockResolvedValue({data:receipt,error:null});
    const result=await PUT(new Request(url,{method:'PUT',headers:{Origin:'https://own.example'},body:JSON.stringify({mix,expectedVersion:null})}));
    expect(result.status).toBe(409);expect(await result.json()).toEqual(receipt);
  });
  it('validates the mix: 0 to 4 per kind, distinct known times, a time for every post', () => {
    for (const mix of [DEFAULT_DNESKAI_DAILY_MIX, { newsPerDay: 0, educationPerDay: 0, slots: ['20:00'] }, { newsPerDay: 4, educationPerDay: 0, slots: ['08:00', '12:30', '17:00', '20:00'] }, { newsPerDay: 0, educationPerDay: 4, slots: ['20:00', '08:00', '17:00', '12:30'] }]) {
      expect(DneskaiDailyMixSchema.safeParse(mix).success, JSON.stringify(mix)).toBe(true);
    }
    for (const mix of [{ newsPerDay: 5, educationPerDay: 0, slots: ['08:00'] }, { newsPerDay: 2, educationPerDay: 1, slots: ['08:00', '17:00'] }, { newsPerDay: 1, educationPerDay: 0, slots: ['09:00'] }, { newsPerDay: 1, educationPerDay: 0, slots: ['08:00', '08:00'] }]) {
      expect(DneskaiDailyMixSchema.safeParse(mix).success, JSON.stringify(mix)).toBe(false);
    }
    expect(dneskaiActiveSlotTimes({ slots: ['17:00', '08:00'] })).toEqual(['08:00', '17:00']);
    expect([0, 1, 4].map((newsPerDay) => dneskaiNewsTopicLimit({ newsPerDay }))).toEqual([0, 3, 12]);
  });

  it('proposes no news topics for zero news posts and asks for the mix\'s number of events otherwise', async () => {
    const limits: number[] = [];
    const from = vi.fn(() => { const b: Record<string, unknown> = {}; for (const m of ['select', 'eq', 'in', 'order']) b[m] = () => b; b.limit = (n: number) => { limits.push(n); return b; }; b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r); return b; });
    const run = '55555555-5555-4555-8555-555555555555', now = new Date('2026-10-23T00:30:00Z');
    expect(await dneskaiNewsTopicsFromRun({ from } as never, owner, project, run, now, { limit: 0 })).toEqual({ events: 0, inserted: 0 });
    expect(from).not.toHaveBeenCalled();
    await dneskaiNewsTopicsFromRun({ from } as never, owner, project, run, now, { limit: dneskaiNewsTopicLimit({ newsPerDay: 1 }) });
    await dneskaiNewsTopicsFromRun({ from } as never, owner, project, run, now, { limit: dneskaiNewsTopicLimit({ newsPerDay: 4 }) });
    expect(limits).toEqual([3, 8]);
  });

  it('narrows the free slots to the active times', () => {
    const now = new Date('2026-10-23T04:00:00Z'); // 06:00 in Prague
    expect(dneskaiFreeSlots('2026-10-23', [], now)).toHaveLength(4);
    expect(dneskaiFreeSlots('2026-10-23', [], now, ['08:00', '17:00'])).toEqual(['2026-10-23T06:00:00.000Z', '2026-10-23T15:00:00.000Z']);
  });

  it('fills a day with as many topics of each kind as the mix asks, for 0, 1 and 4', async () => {
    const briefs = { takenSlots: async () => [] } as unknown as DneskaiBriefStore;
    const now = new Date('2026-10-23T04:00:00Z');
    const committed = (kinds: Array<'news' | 'education'>) => async () => kinds;
    const base = { newsPerDay: 1, educationPerDay: 1, slots: ['08:00', '12:30', '17:00', '20:00'] as const };
    expect(await dneskaiTopicTargetDate(briefs, owner, project, now, { daily: { ...base, educationPerDay: 0, slots: [...base.slots] }, kind: 'education', committed: committed([]) })).toBeNull();
    expect(await dneskaiTopicTargetDate(briefs, owner, project, now, { daily: { ...base, slots: [...base.slots] }, kind: 'education', committed: committed([]) })).toBe('2026-10-23');
    expect(await dneskaiTopicTargetDate(briefs, owner, project, now, { daily: { ...base, slots: [...base.slots] }, kind: 'education', committed: async (_o, _p, date) => date === '2026-10-23' ? ['education'] : [] })).toBe('2026-10-24');
    expect(await dneskaiTopicTargetDate(briefs, owner, project, now, { daily: { newsPerDay: 0, educationPerDay: 4, slots: [...base.slots] }, kind: 'education', committed: committed(['education', 'education', 'education']) })).toBe('2026-10-23');
    expect(await dneskaiTopicTargetDate(briefs, owner, project, now, { daily: { newsPerDay: 0, educationPerDay: 4, slots: [...base.slots] }, kind: 'education', committed: committed(['education', 'education', 'education', 'education']) })).toBeNull();
  });

  it('keeps a news topic waiting while its event day already has the news posts the mix asks for', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const topic: DneskaiBridgeTopic = { id: '33333333-3333-4333-8333-333333333333', kind: 'news', status: 'approved', source_ref: 'event:e', title_cs: 'T', brief_id: '44444444-4444-4444-8444-444444444444', evidence: {} };
    const store = { topics: async () => [topic], brief: async () => ({ id: topic.brief_id, status: 'pending', target_date: '2026-10-23', run_id: '55555555-5555-4555-8555-555555555555', event_id: 'e' }),
      committed: async () => ['news'], updateTopic: async (_o: string, _id: string, patch: Record<string, unknown>) => { updates.push(patch); } } as unknown as DneskaiTopicBridgeStore;
    const result = await advanceDneskaiTopicBriefs({ topics: store, briefs: {} as DneskaiBriefStore }, { owner, project, now: new Date('2026-10-23T04:00:00Z'), signal: new AbortController().signal, remainingMs: () => 40_000, mix: { newsPerDay: 1, educationPerDay: 1, slots: ['08:00', '17:00'] } });
    expect(result).toMatchObject({ waiting: 1 });
    expect(updates[0]).toMatchObject({ evidence: { bridgeCode: 'topic-daily-mix-full' } });
  });

  it('serves and saves the mix only with its switch, through the owner session', async () => {
    const get = await GET(new Request(url));
    expect(await get.json()).toEqual({ mix: DEFAULT_DNESKAI_DAILY_MIX, stored: false, version: null });
    const put = (body: unknown, origin = 'https://own.example') => PUT(new Request(url, { method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({mix:body,expectedVersion:null}) }));
    expect((await put({ newsPerDay: 1, educationPerDay: 2, slots: ['08:00', '12:30', '17:00'] })).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('save_dneskai_daily_mix', {p_project:project,p_expected_updated_at:null,p_mix:{newsPerDay:1,educationPerDay:2,slots:['08:00','12:30','17:00']}});
    expect((await put({ newsPerDay: 3, educationPerDay: 2, slots: ['08:00'] })).status).toBe(400);
    expect((await put(DEFAULT_DNESKAI_DAILY_MIX, 'https://evil.example')).status).toBe(403);
    vi.stubEnv('DNESKAI_DAILY_MIX_ENABLED', '');
    expect((await GET(new Request(url))).status).toBe(404);
    expect((await put(DEFAULT_DNESKAI_DAILY_MIX)).status).toBe(404);
  });
});
