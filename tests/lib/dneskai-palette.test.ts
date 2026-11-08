import { describe, expect, it } from 'vitest';
import { DNESKAI_EMPHASIS_PALETTE, dneskaiEmphasisFor } from '@/lib/marketing/dneskai-palette';
import { DNESKAI_PLAN_ALL_TIMES } from '@/lib/marketing/dneskai-plan-view';

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255).map((c) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi! + 0.05) / (lo! + 0.05); };
/** Prague local time to UTC for November 2026 (CET, UTC+1). */
const at = (date: string, time: string) => new Date(`${date}T${time}:00+01:00`).toISOString();

describe('DNESKAi key-word colours (owner request, 8 November 2026)', () => {
  it('has ten distinct colours, icy blue first, each readable on the ink ground as large text', () => {
    const hexes = DNESKAI_EMPHASIS_PALETTE.map((entry) => entry.hex);
    expect(hexes).toHaveLength(10);
    expect(new Set(hexes).size).toBe(10);
    expect(hexes[0]).toBe('#6ec1ff');
    for (const hex of hexes) expect(contrast(hex, '#0e0f12')).toBeGreaterThanOrEqual(4.5);
  });

  it('never gives two posts in a row the same colour, across days, and keeps a post its colour', () => {
    const order = ['2026-11-09', '2026-11-10', '2026-11-11'].flatMap((date) => DNESKAI_PLAN_ALL_TIMES.map((time) => dneskaiEmphasisFor(at(date, time))));
    for (let index = 1; index < order.length; index++) expect(order[index]).not.toBe(order[index - 1]);
    expect(new Set(order.slice(0, 10)).size).toBe(10);
    expect(dneskaiEmphasisFor(at('2026-11-09', '08:00'))).toBe(order[0]);
  });

  it('falls back to the first colour for an unreadable time', () => {
    expect(dneskaiEmphasisFor('not a date')).toBe('#6ec1ff');
  });
});
