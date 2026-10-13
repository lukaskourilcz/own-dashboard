import { describe, expect, it } from 'vitest';
import { marketingDailyCadence, marketingPreparationPlan, partitionMarketingBacklog, planMarketingWeekSlots, pragueMarketingDate, rollingMarketingWindow, sevenDayMarketingWindow } from '@/lib/marketing/weekly-planning';

const times = { carousel: '18:00', threads: ['10:00', '20:00'] as const, stories: ['09:00', '12:00', '18:00'] as const };
describe('pure seven-day Prague planning without preparation/approval/publication state changes', () => {
  it('plans the confirmed18–24October Sunday week with42devShark deliverables and explicit unsupported Story holds', () => {
    const window = sevenDayMarketingWindow('2026-10-18'), cadence = marketingDailyCadence('devshark', times);
    const slots = planMarketingWeekSlots(window.startDate, cadence);
    expect(window.dates).toEqual(['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
    expect(window).toMatchObject({ startAt: '2026-10-17T22:00:00.000Z', endAtExclusive: '2026-10-24T22:00:00.000Z', endDateExclusive: '2026-10-25' });
    expect(slots).toHaveLength(42); expect(new Set(slots.map(slot => slot.slotKey)).size).toBe(42);
    expect(slots.filter(slot => slot.format === 'carousel')).toHaveLength(7);
    expect(slots.filter(slot => slot.format === 'thread')).toHaveLength(14);
    const stories = slots.filter(slot => slot.format === 'story'); expect(stories).toHaveLength(21);
    expect(stories.every(slot => !slot.publishingSupported && slot.holdCode === 'story-publication-unsupported')).toBe(true);
    expect(slots.every(slot => slot.reviewRequired && !('approved' in slot) && !('ready' in slot) && !('caption' in slot))).toBe(true);
    expect(slots.find(slot => slot.format === 'carousel')).toMatchObject({ localTime: '18:00', scheduledAt: '2026-10-18T16:00:00.000Z' });
    expect(slots.at(-1)?.date).toBe('2026-10-24');
  });
  it('keeps DNESKAi one-feed baseline separate from devShark frequency and does not guess times', () => {
    const slots = planMarketingWeekSlots('2026-10-18', marketingDailyCadence('dneskai', { carousel: '09:00' }));
    expect(slots).toHaveLength(7); expect(slots.every(slot => slot.brand === 'dneskai' && slot.format === 'carousel' && slot.localTime === '09:00')).toBe(true);
    expect(planMarketingWeekSlots('2026-10-18', [])).toEqual([]);
    // Runtime input cannot silently apply devShark's extra channels to DNESKAi.
    expect(() => Reflect.apply(marketingDailyCadence, undefined, ['dneskai', times])).toThrow();
  });
  it('uses Sunday itself, not Monday, for preparation; daily fresh DNESKAi has one source date', () => {
    expect(marketingPreparationPlan('devshark', new Date('2026-10-18T05:00:00Z'))).toMatchObject({ due: true, mode: 'weekly-sunday', preparationDate: '2026-10-18', sourceDates: sevenDayMarketingWindow('2026-10-18').dates, reviewRequired: true });
    expect(marketingPreparationPlan('devshark', new Date('2026-10-13T12:00:00Z'))).toMatchObject({ due: false, preparationDate: '2026-10-18' });
    expect(marketingPreparationPlan('dneskai', new Date('2026-10-13T22:30:00Z'))).toMatchObject({ due: false, mode: 'daily-fresh', preparationDate: '2026-10-14', targetDate: '2026-10-15', dailyTarget: 4, sourceDates: ['2026-10-14'] });
  });
  it('collects at22Prague for four next-day drafts, including both DST offsets, without approving them', () => {
    for (const [before, due, target] of [['2026-10-24T19:59:59Z', '2026-10-24T20:00:00Z', '2026-10-25'], ['2026-10-25T20:59:59Z', '2026-10-25T21:00:00Z', '2026-10-26']]) {
      expect(marketingPreparationPlan('dneskai', new Date(before)).due).toBe(false);
      expect(marketingPreparationPlan('dneskai', new Date(due))).toMatchObject({ due: true, targetDate: target, dailyTarget: 4, reviewRequired: true });
    }
    const cadence = marketingDailyCadence('dneskai', { carousels: ['09:00', '12:00', '16:00', '19:00'] });
    const slots = planMarketingWeekSlots('2026-10-18', cadence);
    expect(slots).toHaveLength(28);
    expect(slots.every(slot => slot.reviewRequired && !('approved' in slot))).toBe(true);
    expect(() => marketingDailyCadence('dneskai', { carousels: ['09:00', '09:00', '16:00', '19:00'] })).toThrow('duplicate-marketing-cadence');
  });
  it.each([['2026-03-29', 167], ['2026-10-25', 169]])('retains seven local dates across DST on%s (%ihours)', (start, hours) => {
    const window = sevenDayMarketingWindow(start); expect(window.dates).toHaveLength(7);
    expect((Date.parse(window.endAtExclusive) - Date.parse(window.startAt)) / 3600000).toBe(hours);
    const slots = planMarketingWeekSlots(start, marketingDailyCadence('dneskai', { carousel: '18:00' }));
    expect(slots).toHaveLength(7); expect(new Set(slots.map(slot => slot.scheduledAt)).size).toBe(7);
  });
  it('refuses invalid/ambiguous slot times, duplicate cadence and wrong platform/format mappings', () => {
    for (const date of ['2026-03-29', '2026-10-25']) expect(() => planMarketingWeekSlots(date, [{ brand: 'devshark', platform: 'instagram', format: 'story', localTime: '02:30' }])).toThrow('ambiguous-or-missing-local-time');
    const cadence = marketingDailyCadence('dneskai', { carousel: '18:00' });
    expect(() => planMarketingWeekSlots('2026-10-18', [...cadence, ...cadence])).toThrow('duplicate-marketing-cadence');
    expect(() => planMarketingWeekSlots('2026-10-18', [{ brand: 'devshark', platform: 'threads', format: 'story', localTime: '18:00' }])).toThrow();
    expect(() => marketingDailyCadence('dneskai', { carousel: '25:00' })).toThrow();
    expect(() => sevenDayMarketingWindow('2026-02-30')).toThrow();
    expect(() => pragueMarketingDate(new Date('invalid'))).toThrow('invalid-planning-time');
  });
  it('partitions a rolling seven-day window without deleting/rescheduling/changing completed or held ideas', () => {
    const entries = [{ id: 'past', date: '2026-10-12', status: 'published' }, { id: 'current', date: '2026-10-13', status: 'planned', needs_review: true },
      { id: 'completed-in-window', date: '2026-10-19', status: 'done' }, { id: 'later', date: '2026-10-20', status: 'blocked' }, { id: 'undated', date: null, status: 'idea' }];
    const before = structuredClone(entries), result = partitionMarketingBacklog(entries, rollingMarketingWindow(new Date('2026-10-13T08:00:00Z')));
    expect(result.upcoming.map(entry => entry.id)).toEqual(['current', 'completed-in-window']);
    expect(result.backlog.map(entry => entry.id)).toEqual(['later']); expect(result.history.map(entry => entry.id)).toEqual(['past']); expect(result.unscheduled.map(entry => entry.id)).toEqual(['undated']);
    expect(result.upcoming[0]).toBe(entries[1]); expect(result.backlog[0]).toBe(entries[3]); expect(entries).toEqual(before);
    expect(() => partitionMarketingBacklog([...entries, entries[0]], result.window)).toThrow('duplicate-or-missing-calendar-id');
    expect(() => partitionMarketingBacklog(entries, { ...result.window, endDateExclusive: '2026-12-31' })).toThrow('invalid-marketing-window');
  });
});
