import { z } from 'zod';
import { BrandSchema, PlatformSchema } from './contracts';
import { sevenDayMarketingWindow } from './weekly-planning';

const observationSchema = z.strictObject({ value: z.number().finite().nullable(), coverage: z.enum(['complete', 'partial', 'unavailable']), sampleSize: z.number().int().nonnegative().nullable() })
  .refine(value => value.coverage !== 'unavailable' || value.value === null, 'unavailable-metric-must-be-null');
export const WeeklyMarketingSnapshotSchema = z.strictObject({
  brand: BrandSchema, platform: PlatformSchema, weekStartsOn: z.iso.date(), definitionsId: z.string().min(1).max(160),
  origin: z.enum(['provider', 'own-persisted']), measuredAt: z.iso.datetime({ offset: true }).nullable(),
  observations: z.record(z.string().regex(/^[a-z][a-zA-Z0-9_]{0,63}$/), observationSchema).refine(value => Object.keys(value).length <= 40, 'too-many-marketing-metrics'),
});
export type WeeklyMarketingSnapshot = z.infer<typeof WeeklyMarketingSnapshotSchema>;
export type MarketingMetricComparisonStatus = 'comparable' | 'no-baseline' | 'incomparable-scope' | 'missing-data' | 'partial-data' | 'zero-baseline' | 'negative-baseline' | 'arithmetic-unavailable';
/** Arithmetic on supplied measured snapshots only. This helper fetches nothing and proves no provider provenance. */
export function compareMarketingWeeks(currentValue: WeeklyMarketingSnapshot, previousValue: WeeklyMarketingSnapshot | null = null) {
  const current = WeeklyMarketingSnapshotSchema.parse(currentValue), previous = previousValue === null ? null : WeeklyMarketingSnapshotSchema.parse(previousValue);
  const window = sevenDayMarketingWindow(current.weekStartsOn), previousWindow = previous ? sevenDayMarketingWindow(previous.weekStartsOn) : null;
  const scopeComparable = !!previous && !!previousWindow && previousWindow.endDateExclusive === window.startDate
    && current.brand === previous.brand && current.platform === previous.platform && current.definitionsId === previous.definitionsId && current.origin === previous.origin;
  const metrics = [...new Set([...Object.keys(current.observations), ...Object.keys(previous?.observations ?? {})])].sort();
  const rows = metrics.map(metric => {
    const observed = current.observations[metric], baseline = previous?.observations[metric];
    const currentTotal = observed?.coverage === 'complete' ? observed.value : null, previousTotal = baseline?.coverage === 'complete' ? baseline.value : null;
    let status: MarketingMetricComparisonStatus = !previous ? 'no-baseline' : !scopeComparable ? 'incomparable-scope'
      : observed?.value == null || baseline?.value == null ? 'missing-data'
      : observed.coverage !== 'complete' || baseline.coverage !== 'complete' ? 'partial-data' : 'comparable';
    let absoluteChange: number | null = null, percentChange: number | null = null;
    if (status === 'comparable' && currentTotal !== null && previousTotal !== null) {
      const delta = currentTotal - previousTotal;
      if (!Number.isFinite(delta)) status = 'arithmetic-unavailable';
      else {
        absoluteChange = delta;
        if (previousTotal === 0) status = 'zero-baseline';
        else if (previousTotal < 0) status = 'negative-baseline';
        else {
          const percent = delta / previousTotal * 100;
          if (Number.isFinite(percent)) percentChange = percent;
          else status = 'arithmetic-unavailable';
        }
      }
    }
    return { metric, status, currentTotal, previousTotal, absoluteChange, percentChange,
      currentObservedValue: observed?.value ?? null, previousObservedValue: baseline?.value ?? null,
      currentCoverage: observed?.coverage ?? 'unavailable' as const, previousCoverage: baseline?.coverage ?? 'unavailable' as const,
      currentSampleSize: observed?.sampleSize ?? null, previousSampleSize: baseline?.sampleSize ?? null };
  });
  return { brand: current.brand, platform: current.platform, origin: current.origin, definitionsId: current.definitionsId,
    window, previousWindow, measuredAt: current.measuredAt, previousMeasuredAt: previous?.measuredAt ?? null, hasBaseline: previous !== null, scopeComparable, rows };
}
