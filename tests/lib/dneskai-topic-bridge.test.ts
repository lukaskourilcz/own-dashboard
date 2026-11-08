import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { advanceDneskaiTopicBriefs, dneskaiTopicPlanSlot, dneskaiTopicTargetDate, type DneskaiBridgeTopic, type DneskaiTopicBridgeStore } from '@/lib/marketing/dneskai-topic-bridge';
import type { DneskaiBriefRow, DneskaiBriefStore } from '@/lib/marketing/dneskai-briefs';
import { dneskaiTopicBriefsEnabled } from '@/lib/marketing/dneskai-evidence-rollout';

/** Fakes for the bridge's decisions; the full path runs in dneskai-topic-bridge-database.test.ts. */
const owner = '11111111-1111-4111-8111-111111111111', project = '22222222-2222-4222-8222-222222222222';
const topic = (patch: Partial<DneskaiBridgeTopic>): DneskaiBridgeTopic => ({ id: '33333333-3333-4333-8333-333333333333', kind: 'news', status: 'approved', source_ref: 'event:e', title_cs: 'Titulek', brief_id: null, evidence: {}, ...patch });
function stores(topics: DneskaiBridgeTopic[], brief: Partial<DneskaiBriefRow> | null = null, taken: string[] = []) {
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const topicStore = { topics: async () => topics, brief: async () => brief as DneskaiBriefRow | null, candidate: async () => null, selectCandidate: vi.fn(), insertTopicBrief: vi.fn(),
    updateTopic: async (_owner: string, id: string, patch: Record<string, unknown>) => { updates.push({ id, patch }); }, job: async () => null } as unknown as DneskaiTopicBridgeStore;
  const briefStore = { takenSlots: async () => taken } as unknown as DneskaiBriefStore;
  return { topicStore, briefStore, updates };
}
const run = (s: ReturnType<typeof stores>, now = new Date('2026-10-23T05:00:00Z')) => advanceDneskaiTopicBriefs({ topics: s.topicStore, briefs: s.briefStore }, { owner, project, now, signal: new AbortController().signal, remainingMs: () => 40_000 });

describe('topic bridge decisions (#155)', () => {
  it('marks an owner-link topic unsupported once when no reader is wired, and a news topic whose brief already queued as briefed', async () => {
    const library = stores([topic({ source_ref: 'library:abc', kind: 'education', evidence: { urls: ['https://www.example.com/clanek'] } })]);
    expect(await run(library)).toMatchObject({ unsupported: 1 });
    expect(library.updates[0]!.patch).toMatchObject({ evidence: { bridgeCode: 'topic-source-unsupported' } });
    const again = stores([topic({ source_ref: 'library:abc', kind: 'education', evidence: { urls: ['https://www.example.com/clanek'], bridgeCode: 'topic-source-unsupported' } })]);
    await run(again); expect(again.updates).toEqual([]);
    const queued = stores([topic({ brief_id: '44444444-4444-4444-8444-444444444444' })], { id: '44444444-4444-4444-8444-444444444444', status: 'queued', job_id: '55555555-5555-4555-8555-555555555555' });
    expect(await run(queued)).toMatchObject({ briefed: 1 });
    expect(queued.updates[0]!.patch).toMatchObject({ status: 'briefed', evidence: { jobId: '55555555-5555-4555-8555-555555555555' } });
  });

  it('leaves the lapse code on a topic whose brief was skipped', async () => {
    const lapsed = stores([topic({ brief_id: '44444444-4444-4444-8444-444444444444' })], { id: '44444444-4444-4444-8444-444444444444', status: 'skipped', code: 'brief-slot-passed' });
    expect(await run(lapsed)).toMatchObject({ waiting: 1 });
    expect(lapsed.updates[0]!.patch).toMatchObject({ evidence: { bridgeCode: 'brief-slot-passed' } });
  });

  it('takes today while it has a slot 30 minutes ahead, then tomorrow, and waits when both are full', async () => {
    const s = stores([]);
    // 07:00 in Prague on 23 October: today's 08:00 is free.
    expect(await dneskaiTopicTargetDate(s.briefStore, owner, project, new Date('2026-10-23T05:00:00Z'))).toBe('2026-10-23');
    // 21:00 in Prague: today is over.
    expect(await dneskaiTopicTargetDate(s.briefStore, owner, project, new Date('2026-10-23T19:00:00Z'))).toBe('2026-10-24');
    const all = (date: string, offset: string) => ['08:00', '12:30', '19:00', '21:00'].map((time) => new Date(`${date}T${time}:00${offset}`).toISOString());
    const full = stores([], null, [...all('2026-10-23', '+02:00'), ...all('2026-10-24', '+02:00')]);
    expect(await dneskaiTopicTargetDate(full.briefStore, owner, project, new Date('2026-10-23T05:00:00Z'))).toBeNull();
  });

  it('briefs a planned topic for exactly its plan day and leaves one beyond the horizon waiting (plan, 7 November 2026)', async () => {
    const report = { id: '77777777-7777-4777-8777-777777777777', run_id: '88888888-8888-4888-8888-888888888888', status: 'candidate', target_date: null, content_hash: 'h', candidate: {} };
    const planned = topic({ kind: 'education', source_ref: `report:${report.id}`, evidence: { planDate: '2026-10-25', planTime: '12:30' } });
    const later = topic({ id: '99999999-9999-4999-8999-999999999999', kind: 'education', source_ref: `report:${report.id}`, evidence: { planDate: '2026-10-30', planTime: '08:00' } });
    const s = stores([planned, later]);
    const select = vi.fn(); const insert = vi.fn(async (_owner: string, row: { target_date: string }) => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...row }));
    Object.assign(s.topicStore, { candidate: async () => report, selectCandidate: select, insertTopicBrief: insert });
    const result = await advanceDneskaiTopicBriefs({ topics: s.topicStore, briefs: s.briefStore }, { owner, project, now: new Date('2026-10-23T05:00:00Z'), signal: new AbortController().signal, remainingMs: () => 40_000, plannedUntil: '2026-10-25' });
    expect(result).toMatchObject({ enriching: 1, waiting: 1 });
    expect(select).toHaveBeenCalledWith(owner, project, report, '2026-10-25');
    expect(insert.mock.calls[0]![1]).toMatchObject({ target_date: '2026-10-25' });
    expect(s.updates[0]!.patch).toMatchObject({ status: 'enriching', evidence: { planDate: '2026-10-25', targetDate: '2026-10-25' } });
  });

  it('reads a plan slot only when both day and time are well formed', () => {
    expect(dneskaiTopicPlanSlot({ evidence: { planDate: '2026-11-08', planTime: '17:00' } })).toEqual({ date: '2026-11-08', time: '17:00' });
    expect(dneskaiTopicPlanSlot({ evidence: { planDate: '2026-11-08' } })).toBeNull();
    expect(dneskaiTopicPlanSlot({ evidence: null })).toBeNull();
  });

  it('is on only with its switch and the topics switch', () => {
    expect(dneskaiTopicBriefsEnabled({ DNESKAI_TOPIC_BRIEFS_ENABLED: 'true', DNESKAI_TOPICS_ENABLED: 'true' })).toBe(true);
    expect(dneskaiTopicBriefsEnabled({ DNESKAI_TOPIC_BRIEFS_ENABLED: 'true' })).toBe(false);
  });
});
