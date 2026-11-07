import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDneskaiPlanFixture, demoDneskaiPlanApi } from '@/lib/demo/dneskai-plan-fixtures';
import { DNESKAI_PLAN_STATUS_TONES, DneskaiPlanRequestError, dneskaiPlanKey, dneskaiPlanRelativeDay, dneskaiPlanTextIsLong, dneskaiPlanUrl, liveDneskaiPlanApi } from '@/lib/marketing/dneskai-plan-client';
import { DNESKAI_PLAN_STATUSES, DNESKAI_PLAN_TIMES, DneskaiPlanReadSchema, dneskaiPlanDayCounts, dneskaiPlanDays } from '@/lib/marketing/dneskai-plan-view';

const now = new Date('2026-11-07T09:15:00.000Z');
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('the DNESKAi plan URL and key', () => {
  it('sends only a valid date and a day count from 1 to 31', () => {
    expect(dneskaiPlanUrl()).toBe('/api/marketing/dneskai/plan');
    expect(dneskaiPlanUrl({ days: 30 })).toBe('/api/marketing/dneskai/plan?days=30');
    expect(dneskaiPlanUrl({ from: '2026-11-07', days: 2 })).toBe('/api/marketing/dneskai/plan?from=2026-11-07&days=2');
    expect(dneskaiPlanUrl({ from: '7. 11.', days: 0 })).toBe('/api/marketing/dneskai/plan');
    expect(dneskaiPlanUrl({ days: 32 })).toBe('/api/marketing/dneskai/plan');
    expect(dneskaiPlanUrl({ days: 2.5 })).toBe('/api/marketing/dneskai/plan');
  });
  it('keys the two-day and the 30-day read apart', () => {
    expect(dneskaiPlanKey()).toEqual(['marketing', 'dneskai-plan', 'today', 2]);
    expect(dneskaiPlanKey({ days: 30 })).not.toEqual(dneskaiPlanKey());
  });
});

describe('the DNESKAi plan helpers', () => {
  it('names today and tomorrow across a month end', () => {
    expect(dneskaiPlanRelativeDay('2026-11-30', '2026-11-30')).toBe('today');
    expect(dneskaiPlanRelativeDay('2026-12-01', '2026-11-30')).toBe('tomorrow');
    expect(dneskaiPlanRelativeDay('2026-12-02', '2026-11-30')).toBe('other');
  });
  it('gives every status a tone and marks failures as risk', () => {
    expect(Object.keys(DNESKAI_PLAN_STATUS_TONES).sort()).toEqual([...DNESKAI_PLAN_STATUSES].sort());
    expect(DNESKAI_PLAN_STATUS_TONES.failed).toBe('risk');
    expect(DNESKAI_PLAN_STATUS_TONES.published).toBe('success');
  });
  it('collapses long or many-line texts only', () => {
    expect(dneskaiPlanTextIsLong('Krátký text.')).toBe(false);
    expect(dneskaiPlanTextIsLong('a'.repeat(281))).toBe(true);
    expect(dneskaiPlanTextIsLong('1\n2\n3\n4\n5\n6')).toBe(true);
  });
});

describe('the live plan read', () => {
  it('validates the answer and refuses a malformed one', async () => {
    const good = createDneskaiPlanFixture(now);
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(good))).mockResolvedValueOnce(new Response(JSON.stringify({ ...good, schemaVersion: 'x' })));
    vi.stubGlobal('fetch', fetch);
    await expect(liveDneskaiPlanApi.load({ days: 2 })).resolves.toEqual(good);
    expect(fetch.mock.calls[0]![0]).toBe('/api/marketing/dneskai/plan?days=2');
    await expect(liveDneskaiPlanApi.load({})).rejects.toMatchObject({ code: 'plan-unreadable' });
  });
  it('keeps the server error code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'owner-required' }), { status: 401 })));
    const error = await liveDneskaiPlanApi.load({}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DneskaiPlanRequestError);
    expect(error).toMatchObject({ code: 'owner-required', status: 401 });
  });
});

describe('the preview plan fixture', () => {
  it('passes the read schema for two days and for 30 days', () => {
    for (const days of [1, 2, 30]) expect(DneskaiPlanReadSchema.safeParse(createDneskaiPlanFixture(now, { days })).success).toBe(true);
  });
  it('fills today and tomorrow with every time and points the slots with slides at the Lab', () => {
    const read = createDneskaiPlanFixture(now);
    const days = dneskaiPlanDays(read);
    expect(days.map((day) => day.date)).toEqual(['2026-11-07', '2026-11-08']);
    for (const day of days) expect(day.slots.map((slot) => slot.time)).toEqual([...DNESKAI_PLAN_TIMES]);
    expect(dneskaiPlanDayCounts(days[0]!.slots)).toEqual({ instagram: 3, threads: 4 });
    for (const slot of read.slots.filter((item) => item.slides.length > 0)) expect(slot.labPostId).not.toBeNull();
    expect(read.accounts.threads).toBeNull();
  });
  it('answers the 30-day read from the demo without a network call', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const read = await demoDneskaiPlanApi.load({ days: 30 });
    expect(dneskaiPlanDays(read)).toHaveLength(30);
    expect(fetch).not.toHaveBeenCalled();
  });
});
