import { describe, expect, it } from 'vitest';
import { DNESKAI_SERIES, DNESKAI_SERIES_LABELS, DNESKAI_SERIES_START, dneskaiSeriesAssignment, dneskaiSeriesHeading, dneskaiSeriesNumbers, dneskaiSeriesOf, dneskaiSeriesSlot } from '@/lib/marketing/dneskai-series';

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
    expect(dneskaiSeriesSlot('2026-11-21', '12:30')).toBe('karpathy'); // Saturday
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

  it('gives Sunday to Cherny, Mollick and Pocock by turns, week after week', () => {
    expect(['2026-11-22', '2026-11-29', '2026-12-06', '2026-12-13', '2026-12-20'].map((date) => dneskaiSeriesSlot(date, '12:30')))
      .toEqual(['cherny', 'mollick', 'pocock', 'cherny', 'mollick']);
    expect(dneskaiSeriesSlot('2026-11-15', '12:30')).toBeNull(); // the Sunday before the start
  });

  it('labels every series and numbers its heading', () => {
    expect(Object.keys(DNESKAI_SERIES_LABELS).sort()).toEqual([...DNESKAI_SERIES].sort());
    expect(dneskaiSeriesHeading('explainer', 3)).toBe('Slovník AI #3');
    expect(dneskaiSeriesHeading('mosseri', 1)).toBe('Tipy od šéfa Instagramu Mosseriho #1');
    expect(dneskaiSeriesHeading('pocock', 12)).toBe('Tipy Matta Pococka na AI skills #12');
  });

  it('numbers published posts first, then the coming ones in slot order, with no gap for a skipped post', () => {
    const slot = (id: string, date: string, series: 'mosseri' | 'explainer', status: string) => ({ id, date, local_time: '12:30', series, status });
    const numbers = dneskaiSeriesNumbers([
      slot('m3', '2026-11-24', 'mosseri', 'approved'),
      slot('m1', '2026-11-17', 'mosseri', 'published'),
      slot('m2', '2026-11-19', 'mosseri', 'skipped'),
      slot('e1', '2026-11-16', 'explainer', 'published'),
      slot('m4', '2026-11-26', 'mosseri', 'planned'),
      slot('e2', '2026-11-18', 'explainer', 'failed'),
    ]);
    expect(Object.fromEntries(numbers)).toEqual({ m1: 1, m3: 2, m4: 3, e1: 1 });
  });
});
