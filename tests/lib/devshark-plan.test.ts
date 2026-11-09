import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { DEVSHARK_PLAN_SLOTS, devsharkPlanAssignments, devsharkPlanDailyCounts, devsharkPlanEmptySlots, devsharkPlanEnabled } from '@/lib/marketing/devshark-plan';

/** The devShark cadence (owner request, 7 November 2026): one Instagram post and two Threads posts a day. */
describe('devShark plan cadence', () => {
  it('holds exactly one Instagram and two Threads posts on every day', () => {
    const slots = devsharkPlanEmptySlots([], '2026-11-08', '2026-12-07');
    const counts = devsharkPlanDailyCounts(slots);
    expect(counts.size).toBe(30);
    for (const day of counts.values()) expect(day).toEqual({ instagram: 1, threads: 2 });
  });

  it('posts on Instagram and Threads at 16:00 and on Threads alone at 19:00', () => {
    expect(DEVSHARK_PLAN_SLOTS).toEqual([{ time: '16:00', instagram: true, threads: true }, { time: '19:00', instagram: false, threads: true }]);
  });

  it('leaves taken slots alone', () => {
    const slots = devsharkPlanEmptySlots([{ date: '2026-11-08', local_time: '16:00' }], '2026-11-08', '2026-11-09');
    expect(slots.map((slot) => `${slot.date} ${slot.time}`)).toEqual(['2026-11-08 19:00', '2026-11-09 16:00', '2026-11-09 19:00']);
  });

  it('reserves strong concepts for Wednesday and Friday Instagram slots', () => {
    const slots = devsharkPlanEmptySlots([{ date: '2026-11-11', local_time: '16:00' }], '2026-11-10', '2026-11-13');
    const assigned = devsharkPlanAssignments(slots, [{ id: 'regular' }], [{ id: 'strong' }, { id: 'later' }]);
    expect(assigned.map(({ slot, draft }) => [slot.date, slot.time, draft.id])).toEqual([
      ['2026-11-10', '16:00', 'regular'],
      ['2026-11-13', '16:00', 'strong'],
    ]);
  });

  it('is off unless DEVSHARK_PLAN_ENABLED is true', () => {
    expect(devsharkPlanEnabled({})).toBe(false);
    expect(devsharkPlanEnabled({ DEVSHARK_PLAN_ENABLED: 'true' })).toBe(true);
  });
});
