import { describe, expect, it } from 'vitest';
import { DNESKAI_SERIES, DNESKAI_SERIES_GRID, DNESKAI_SERIES_LABELS, DNESKAI_SERIES_START, dneskaiSeriesAssignment, dneskaiSeriesCaption, dneskaiSeriesDeck, dneskaiSeriesHeading, dneskaiSeriesNumbers, dneskaiSeriesOf, dneskaiSeriesSlot } from '@/lib/marketing/dneskai-series';

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

  it('follows the weekly grid from the start date, at 12:30 and 17:00 only', () => {
    expect(DNESKAI_SERIES_START).toBe('2026-11-16');
    const week = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];
    expect(week.map((date) => dneskaiSeriesSlot(date, '12:30'))).toEqual(['explainer', 'mosseri', 'explainer', 'mosseri', 'explainer', 'cherny', 'pocock']);
    expect(week.map((date) => dneskaiSeriesSlot(date, '17:00'))).toEqual(['karpathy', 'cherny', 'mollick', 'pocock', 'karpathy', 'mollick', null]);
    for (const date of week) for (const time of ['08:00', '20:00']) expect(dneskaiSeriesSlot(date, time)).toBeNull();
    expect(dneskaiSeriesSlot('2026-11-13', '12:30')).toBeNull(); // before the start
    expect(dneskaiSeriesSlot('16. 11.', '12:30')).toBeNull();
  });

  it('gives every series at least two posts a week, and the glossary three', () => {
    const count = new Map<string, number>();
    for (const day of Object.values(DNESKAI_SERIES_GRID)) for (const series of Object.values(day)) count.set(series!, (count.get(series!) ?? 0) + 1);
    expect(Object.fromEntries(count)).toEqual({ explainer: 3, mosseri: 2, karpathy: 2, cherny: 2, mollick: 2, pocock: 2 });
  });

  it('seats series topics in their slots and ordinary topics in the rest, in slot order', () => {
    const empty = [slot('2026-11-16', '08:00'), slot('2026-11-16', '12:30'), slot('2026-11-17', '12:30'), slot('2026-11-17', '20:00')];
    const pairs = dneskaiSeriesAssignment(empty, [topic('a'), topic('m1', 'mosseri'), topic('b'), topic('e1', 'explainer'), topic('m2', 'mosseri')], '2026-11-10');
    expect(pairs.map((pair) => [pair.slot.date, pair.slot.time, pair.topic.id])).toEqual([
      ['2026-11-16', '08:00', 'a'],
      ['2026-11-16', '12:30', 'e1'],
      ['2026-11-17', '12:30', 'm1'],
      ['2026-11-17', '20:00', 'b'],
    ]);
  });

  it('keeps a series slot free for a later series topic, until it is about to be prepared', () => {
    const empty = [slot('2026-11-16', '12:30'), slot('2026-11-18', '12:30'), slot('2026-11-18', '20:00')];
    const reserved = dneskaiSeriesAssignment(empty, [topic('a'), topic('b')], '2026-11-15');
    expect(reserved.map((pair) => [pair.slot.date, pair.slot.time, pair.topic.id])).toEqual([['2026-11-18', '20:00', 'a']]);
    const released = dneskaiSeriesAssignment(empty, [topic('a'), topic('b')], '2026-11-16');
    expect(released.map((pair) => [pair.slot.date, pair.slot.time, pair.topic.id])).toEqual([['2026-11-16', '12:30', 'a'], ['2026-11-18', '20:00', 'b']]);
  });

  it('never puts a series topic outside its series slots', () => {
    const pairs = dneskaiSeriesAssignment([slot('2026-11-16', '08:00'), slot('2026-11-17', '12:30')], [topic('e1', 'explainer')], '2026-11-30');
    expect(pairs).toEqual([]);
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

  it('puts the heading on the first caption line, replacing an older number, and on the cover only', () => {
    expect(dneskaiSeriesCaption('Harness je software kolem modelu.\n\n#dneskai #ai', 'Slovník AI #1')).toBe('Slovník AI #1\nHarness je software kolem modelu.\n\n#dneskai #ai');
    expect(dneskaiSeriesCaption('Slovník AI #1\nHarness je software kolem modelu.', 'Slovník AI #2')).toBe('Slovník AI #2\nHarness je software kolem modelu.');
    expect(dneskaiSeriesCaption('Tipy od šéfa Instagramu Mosseriho #4\nText.', 'Tipy od šéfa Instagramu Mosseriho #3')).toBe('Tipy od šéfa Instagramu Mosseriho #3\nText.');
    expect(dneskaiSeriesCaption('Slovník AI je naše nová série.', 'Slovník AI #1')).toBe('Slovník AI #1\nSlovník AI je naše nová série.');
    const deck = { slides: [{ type: 'cover-photo', headline: 'A' }, { type: 'figure', headline: 'B' }] };
    expect(dneskaiSeriesDeck(deck, 'Slovník AI #1').slides).toEqual([{ type: 'cover-photo', headline: 'A', series: 'Slovník AI #1' }, { type: 'figure', headline: 'B' }]);
    const single = { slides: [{ type: 'single', headline: 'A' }] };
    expect(dneskaiSeriesDeck(single, 'Slovník AI #1')).toBe(single);
  });
});

