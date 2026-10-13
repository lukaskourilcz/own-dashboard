import { describe, expect, it } from 'vitest';
import { compareMarketingWeeks, type WeeklyMarketingSnapshot } from '@/lib/marketing/weekly-analytics';

// Synthetic measured-value arithmetic fixtures only; no provider, production account or real metrics were fetched.
function snapshot(weekStartsOn: string, observations: WeeklyMarketingSnapshot['observations']): WeeklyMarketingSnapshot {
  return { brand: 'devshark', platform: 'instagram', weekStartsOn, definitionsId: 'TEST-ONLY-COUNTERS/1', origin: 'own-persisted', measuredAt: '2026-11-02T10:00:00Z', observations };
}
const complete = (value: number | null) => ({ value, coverage: 'complete' as const, sampleSize: 7 });
describe('weekly arithmetic with explicit observations/coverage, never fabricated historical comparisons', () => {
  it('keeps first-week totals measured but comparison/percentages unknown with no baseline', () => {
    const result = compareMarketingWeeks(snapshot('2026-10-18', { publishedPosts: complete(7), reach: { value: null, coverage: 'unavailable', sampleSize: null } }));
    expect(result).toMatchObject({ hasBaseline: false, scopeComparable: false, previousWindow: null, previousMeasuredAt: null });
    expect(result.rows[0]).toMatchObject({ metric: 'publishedPosts', currentTotal: 7, previousTotal: null, status: 'no-baseline', absoluteChange: null, percentChange: null });
    expect(result.rows[1]).toMatchObject({ metric: 'reach', currentTotal: null, currentObservedValue: null, currentCoverage: 'unavailable', absoluteChange: null });
    expect(result).not.toHaveProperty('recommendations');
  });
  it('compares only complete consecutive observations and treats a genuine zero as zero', () => {
    const before = snapshot('2026-10-11', { likes: complete(100), comments: complete(0) });
    const current = snapshot('2026-10-18', { likes: complete(125), comments: complete(3) });
    const untouched = structuredClone([current, before]);
    const result = compareMarketingWeeks(current, before);
    expect(result.scopeComparable).toBe(true);
    expect(result.rows.find(row => row.metric === 'likes')).toMatchObject({ currentTotal: 125, previousTotal: 100, absoluteChange: 25, percentChange: 25, status: 'comparable' });
    expect(result.rows.find(row => row.metric === 'comments')).toMatchObject({ previousTotal: 0, absoluteChange: 3, percentChange: null, status: 'zero-baseline' });
    expect([current, before]).toEqual(untouched);
  });
  it('does not turn partial samples or absent metric keys into weekly totals, zeros or growth', () => {
    const current = snapshot('2026-10-18', { likes: { value: 12, coverage: 'partial', sampleSize: 2 }, reach: complete(null) });
    const previous = snapshot('2026-10-11', { likes: complete(100), reach: complete(200), clicks: complete(6) });
    const result = compareMarketingWeeks(current, previous);
    expect(result.rows.find(row => row.metric === 'likes')).toMatchObject({ currentTotal: null, currentObservedValue: 12, currentSampleSize: 2, status: 'partial-data', absoluteChange: null, percentChange: null });
    expect(result.rows.find(row => row.metric === 'clicks')).toMatchObject({ currentTotal: null, previousTotal: 6, currentCoverage: 'unavailable', status: 'missing-data', absoluteChange: null });
    expect(result.rows.find(row => row.metric === 'reach')).toMatchObject({ currentTotal: null, status: 'missing-data' });
  });
  it.each([{ brand: 'dneskai' as const }, { platform: 'threads' as const }, { definitionsId: 'different-collection-definition' }, { origin: 'provider' as const }, { weekStartsOn: '2026-10-04' }])('refuses incomparable snapshot scope: %j', patch => {
    const current = snapshot('2026-10-18', { likes: complete(125) }), previous = { ...snapshot('2026-10-11', { likes: complete(100) }), ...patch };
    const result = compareMarketingWeeks(current, previous);
    expect(result.scopeComparable).toBe(false); expect(result.rows[0]).toMatchObject({ currentTotal: 125, previousTotal: 100, status: 'incomparable-scope', absoluteChange: null, percentChange: null });
  });
  it('compares seven local days across DST, and avoids percentages against signed or overflowing baselines', () => {
    const current = snapshot('2026-10-25', { netFollowers: complete(-3), huge: complete(Number.MAX_VALUE) });
    const previous = snapshot('2026-10-18', { netFollowers: complete(-5), huge: complete(-Number.MAX_VALUE) });
    const result = compareMarketingWeeks(current, previous);
    expect(result.scopeComparable).toBe(true); expect((Date.parse(result.window.endAtExclusive) - Date.parse(result.window.startAt)) / 3600000).toBe(169);
    expect(result.rows.find(row => row.metric === 'netFollowers')).toMatchObject({ absoluteChange: 2, percentChange: null, status: 'negative-baseline' });
    expect(result.rows.find(row => row.metric === 'huge')).toMatchObject({ absoluteChange: null, percentChange: null, status: 'arithmetic-unavailable' });
    expect(JSON.stringify(result)).not.toContain('Infinity');
  });
  it('fails closed on non-finite, contradictory unavailable observations or invalid window dates', () => {
    for (const value of [NaN, Infinity]) expect(() => compareMarketingWeeks(snapshot('2026-10-18', { likes: complete(value) }))).toThrow();
    expect(() => compareMarketingWeeks(snapshot('2026-10-18', { likes: { value: 0, coverage: 'unavailable', sampleSize: null } }))).toThrow();
    expect(() => compareMarketingWeeks(snapshot('2026-02-30', {}))).toThrow();
    expect(compareMarketingWeeks(snapshot('2026-10-18', {})).rows).toEqual([]);
  });
});
