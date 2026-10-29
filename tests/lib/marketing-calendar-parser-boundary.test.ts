import { describe, expect, it } from 'vitest';
import { MAX_CALENDAR_ENTRIES, MAX_PRELAUNCH_ITEMS, parseMarketingCalendar } from '@/lib/marketing-calendars';
const entry = (id: string, extra: Record<string, unknown> = {}) => ({ id, date: '2026-11-05', title: id, ...extra });
const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, due: '2026-11-04', title: id, ...extra });
function parse(entries: unknown[], prelaunch: unknown[] = []) {
  const result = parseMarketingCalendar(JSON.stringify({ schemaVersion: 'marketing-calendar/1', project: 'devshark', entries, prelaunch }), 'devshark');
  expect(result.ok).toBe(true); if (!result.ok) throw Error('TEST_ONLY_INVALID_FIXTURE'); return result.calendar;
}
describe('bounded calendar projections', () => {
  it('counts every row omitted by either document limit', () => {
    const result = parse(Array.from({ length: MAX_CALENDAR_ENTRIES + 20 }, (_, i) => entry(`e${i}`)), Array.from({ length: MAX_PRELAUNCH_ITEMS + 5 }, (_, i) => item(`p${i}`)));
    expect(result.entries).toHaveLength(MAX_CALENDAR_ENTRIES); expect(result.prelaunch).toHaveLength(MAX_PRELAUNCH_ITEMS); expect(result.skipped).toBe(25);
  });
  it('keeps the first valid identity in each list and counts later duplicates', () => {
    const result = parse([entry('a', { date: 'invalid' }), entry('a', { title: 'First valid' }), entry(' a ', { title: 'Later conflicting duplicate' }), entry('a')], [item('a'), item(' a ')]);
    expect(result.entries).toHaveLength(1); expect(result.entries[0]?.title).toBe('First valid'); expect(result.prelaunch).toHaveLength(1); expect(result.skipped).toBe(4);
  });
  it('refuses an overlong identity instead of changing its deep-link target', () => {
    const id = 'a'.repeat(300), result = parse([entry(id), entry(id + 'b')], [item(id + 'c')]);
    expect(result.entries.map(row => row.id)).toEqual([id]); expect(result.prelaunch).toEqual([]); expect(result.skipped).toBe(2);
  });
  it('keeps valid wall times and represents invalid or missing optional times as unknown', () => {
    const times = ['00:00', '23:59', '24:00', '99:99', '12:60', '7:00', null, undefined, 0];
    const result = parse(times.map((time, index) => entry(`e${index}`, { time })));
    expect(result.entries.filter(row => row.time !== null).map(row => row.time)).toEqual(['00:00', '23:59']); expect(result.skipped).toBe(0);
  });
  it('counts invalid and repeated rows inside the prefix plus the entire omitted remainder', () => {
    const entries: unknown[] = Array.from({ length: MAX_CALENDAR_ENTRIES + 3 }, (_, i) => entry(`e${i}`)); entries[0] = null; entries[2] = entry('e1');
    const result = parse(entries); expect(result.entries).toHaveLength(MAX_CALENDAR_ENTRIES - 2); expect(result.skipped).toBe(5);
  });
  it('allows the same identity in the separate entry and prelaunch collections', () => {
    const result = parse([entry('same')], [item('same')]); expect(result.skipped).toBe(0); expect(result.entries).toHaveLength(1); expect(result.prelaunch).toHaveLength(1);
  });
});
