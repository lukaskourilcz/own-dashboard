import { describe, expect, it } from 'vitest';
import { DNESKAI_SERIES_START, dneskaiSeriesAssignment, dneskaiSeriesOf, dneskaiSeriesSlot } from '@/lib/marketing/dneskai-series';

const topic = (id: string, series?: string) => ({ id, evidence: series ? { series } : {} });
const slot = (date: string, time: string) => ({ date, time });

describe('the DNESKAi series', () => {
  it('reads the series tag and ignores anything else', () => {
    expect(dneskaiSeriesOf({ series: 'mosseri' })).toBe('mosseri');
    expect(dneskaiSeriesOf({ series: 'explainer' })).toBe('explainer');
    expect(dneskaiSeriesOf({ series: 'reels' })).toBeNull();
    expect(dneskaiSeriesOf({ series: 1 })).toBeNull();
    expect(dneskaiSeriesOf(null)).toBeNull();
  });

  it('owns 12:30 on weekdays from the start date: explainer Mon/Wed/Fri, Mosseri Tue/Thu', () => {
    expect(DNESKAI_SERIES_START).toBe('2026-11-16');
    expect(dneskaiSeriesSlot('2026-11-16', '12:30')).toBe('explainer'); // Monday
    expect(dneskaiSeriesSlot('2026-11-17', '12:30')).toBe('mosseri');
    expect(dneskaiSeriesSlot('2026-11-18', '12:30')).toBe('explainer');
    expect(dneskaiSeriesSlot('2026-11-19', '12:30')).toBe('mosseri');
    expect(dneskaiSeriesSlot('2026-11-20', '12:30')).toBe('explainer');
    expect(dneskaiSeriesSlot('2026-11-21', '12:30')).toBeNull(); // Saturday
    expect(dneskaiSeriesSlot('2026-11-22', '12:30')).toBeNull();
    expect(dneskaiSeriesSlot('2026-11-16', '17:00')).toBeNull();
    expect(dneskaiSeriesSlot('2026-11-13', '12:30')).toBeNull(); // before the start
    expect(dneskaiSeriesSlot('16. 11.', '12:30')).toBeNull();
  });

  it('seats series topics in their slots and ordinary topics in the rest, in slot order', () => {
    const empty = [slot('2026-11-16', '08:00'), slot('2026-11-16', '12:30'), slot('2026-11-17', '12:30'), slot('2026-11-17', '17:00')];
    const pairs = dneskaiSeriesAssignment(empty, [topic('a'), topic('m1', 'mosseri'), topic('b'), topic('e1', 'explainer'), topic('m2', 'mosseri')], '2026-11-10');
    expect(pairs.map((pair) => [pair.slot.date, pair.slot.time, pair.topic.id])).toEqual([
      ['2026-11-16', '08:00', 'a'],
      ['2026-11-16', '12:30', 'e1'],
      ['2026-11-17', '12:30', 'm1'],
      ['2026-11-17', '17:00', 'b'],
    ]);
  });

  it('keeps a series slot free for a later series topic, until it is about to be prepared', () => {
    const empty = [slot('2026-11-16', '12:30'), slot('2026-11-18', '12:30'), slot('2026-11-18', '17:00')];
    const reserved = dneskaiSeriesAssignment(empty, [topic('a'), topic('b')], '2026-11-15');
    expect(reserved.map((pair) => [pair.slot.date, pair.slot.time, pair.topic.id])).toEqual([['2026-11-18', '17:00', 'a']]);
    const released = dneskaiSeriesAssignment(empty, [topic('a'), topic('b')], '2026-11-16');
    expect(released.map((pair) => [pair.slot.date, pair.slot.time, pair.topic.id])).toEqual([['2026-11-16', '12:30', 'a'], ['2026-11-18', '17:00', 'b']]);
  });

  it('never puts a series topic outside its series slots', () => {
    const pairs = dneskaiSeriesAssignment([slot('2026-11-16', '08:00'), slot('2026-11-17', '12:30')], [topic('e1', 'explainer')], '2026-11-30');
    expect(pairs).toEqual([]);
  });
});
