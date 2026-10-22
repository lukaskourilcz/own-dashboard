import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DNESKAI_MOVE_LEAD_MINUTES, dneskaiLabQueue, dneskaiMissedSlot, dneskaiNextFreeSlot, dneskaiTakenSlots } from '@/lib/marketing/dneskai-lab';
import { createDneskaiWorkspaceFixture } from '@/lib/demo/dneskai-workspace-fixtures';
import { demoDneskaiWorkspaceApi, resetDemoDneskaiWorkspace } from '@/lib/demo/dneskai-workspace-demo';
import { DneskaiWorkspaceReadSchema } from '@/lib/marketing/dneskai-workspace';
import { pragueScheduledAt } from '@/lib/marketing/clock';

// 22 October 2026, 12:00 in Prague (UTC+2).
const now = new Date('2026-10-22T10:00:00.000Z');
const slots = ['08:00', '12:30', '17:00', '20:00'];
const at = (date: string, time: string) => pragueScheduledAt(date, time);

describe('dneskaiNextFreeSlot (owner decision 6)', () => {
  it('takes the next daily slot at least 15 minutes ahead and an hour clear of other posts', () => {
    expect(dneskaiNextFreeSlot({ today: '2026-10-22', slots, taken: [], now: now.getTime() })).toBe(at('2026-10-22', '12:30'));
    // 12:20: 12:30 is only 10 minutes away.
    expect(dneskaiNextFreeSlot({ today: '2026-10-22', slots, taken: [], now: Date.parse('2026-10-22T10:20:00Z') })).toBe(at('2026-10-22', '17:00'));
    expect(DNESKAI_MOVE_LEAD_MINUTES).toBe(15);
    expect(dneskaiNextFreeSlot({ today: '2026-10-22', slots, taken: [at('2026-10-22', '13:00'), at('2026-10-22', '17:30')], now: now.getTime() })).toBe(at('2026-10-22', '20:00'));
  });

  it('falls back to tomorrow, across the clock change, and answers null when both days are full', () => {
    expect(dneskaiNextFreeSlot({ today: '2026-10-24', slots, taken: [], now: Date.parse('2026-10-24T19:00:00Z') })).toBe('2026-10-25T07:00:00.000Z');
    const full = ['2026-10-22', '2026-10-23'].flatMap((date) => slots.map((time) => at(date, time)));
    expect(dneskaiNextFreeSlot({ today: '2026-10-22', slots, taken: full, now: now.getTime() })).toBeNull();
  });

  it('counts other posts, drafting jobs and waiting topics from the read, never the moved post itself', () => {
    const read = createDneskaiWorkspaceFixture(now);
    const missed = read.posts.find((post) => post.title === 'Malý model bez připojení')!;
    const taken = dneskaiTakenSlots(read, missed.id);
    expect(taken).not.toContain(missed.scheduledAt);
    expect(taken).toEqual(expect.arrayContaining([at('2026-10-22', '17:00'), at('2026-10-22', '20:00'), at('2026-10-23', '20:00'), at('2026-10-23', '08:00')]));
    // Skipped and superseded posts free their slot.
    expect(dneskaiTakenSlots({ ...read, posts: read.posts.map((post) => ({ ...post, status: 'skipped' as const })), jobs: [], waiting: [] }, missed.id)).toEqual([]);
  });

  it('marks a post in review whose slot passed as moved, and the day lists its waiting topics', () => {
    const read = DneskaiWorkspaceReadSchema.parse(createDneskaiWorkspaceFixture(now));
    const [today] = dneskaiLabQueue(read, now.getTime());
    const missed = today!.posts.filter(dneskaiMissedSlot);
    expect(missed.map((item) => item.post.title)).toEqual(['Malý model bez připojení']);
    expect(today!.approvable.map((item) => item.id)).not.toContain(missed[0]!.post.id);
    expect(today!.waiting.map((item) => item.title)).toEqual(['Jak číst kartu modelu', 'Kdy pomůže vyhledávání v dokumentech']);
  });
});

describe('preview stand-ins for decisions 6, 8 and 9', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] }); vi.setSystemTime(now); resetDemoDneskaiWorkspace(); });
  afterEach(() => { vi.useRealTimers(); });
  const settle = async <T>(promise: Promise<T>) => { const result = promise.then((value) => ({ value }), (error: unknown) => ({ error })); await vi.runAllTimersAsync(); return result; };

  it('approves the missed post only for the slot the server would pick', async () => {
    const read = await settle(demoDneskaiWorkspaceApi.loadReview('p'));
    const missed = ('value' in read ? read.value : null)!.posts.find((post) => post.title === 'Malý model bez připojení')!;
    const wrong = await settle(demoDneskaiWorkspaceApi.approveAt(missed.id, missed.contentHash, at('2026-10-22', '17:00')));
    expect(wrong).toMatchObject({ error: { code: 'slot-unavailable' } });
    const done = await settle(demoDneskaiWorkspaceApi.approveAt(missed.id, missed.contentHash, at('2026-10-22', '12:30')));
    expect(done).toEqual({ value: { id: missed.id, scheduledAt: at('2026-10-22', '12:30') } });
    const after = await settle(demoDneskaiWorkspaceApi.loadReview('p'));
    expect(('value' in after ? after.value : null)!.posts.find((post) => post.id === missed.id)).toMatchObject({ status: 'approved', scheduledAt: at('2026-10-22', '12:30') });
  });

  it('turns a regeneration and a waiting topic into drafting jobs and refuses the paid action past the daily ceiling', async () => {
    const read = await settle(demoDneskaiWorkspaceApi.loadReview('p'));
    const returned = ('value' in read ? read.value : null)!.posts.find((post) => post.status === 'returned')!;
    expect(await settle(demoDneskaiWorkspaceApi.regenerate(returned.id, '0'.repeat(64), 'Kratší titulek'))).toMatchObject({ error: { code: 'revision-changed' } });
    expect(await settle(demoDneskaiWorkspaceApi.regenerate(returned.id, returned.contentHash, 'Kratší titulek'))).toMatchObject({ value: { status: 'queued' } });
    const refused = await settle(demoDneskaiWorkspaceApi.generateNow('d0e5ca10-0000-4000-8000-000000000501'));
    expect(refused).toMatchObject({ error: { code: 'dneskai-daily-generation-budget-exhausted' } });
    resetDemoDneskaiWorkspace();
    expect(await settle(demoDneskaiWorkspaceApi.generateNow('d0e5ca10-0000-4000-8000-000000000501'))).toMatchObject({ value: { status: 'queued' } });
    const after = await settle(demoDneskaiWorkspaceApi.loadReview('p'));
    const value = ('value' in after ? after.value : null)!;
    expect(value.waiting!.map((brief) => brief.title)).toEqual(['Kdy pomůže vyhledávání v dokumentech']);
    expect(value.jobs[0]).toMatchObject({ status: 'running', title: 'Jak číst kartu modelu' });
  });
});
