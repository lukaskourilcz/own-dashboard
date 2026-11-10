import { z } from 'zod';

export const StrategyScopeSchema = z.strictObject({ projectId: z.uuid(), brand: z.enum(['devshark', 'dneskai']) });
export const StrategyDraftRequestSchema = StrategyScopeSchema.extend({ ideaId: z.string().regex(/^[a-z][a-z0-9-]{0,60}$/) });
const count = z.number().int().min(0).max(2_000_000_000).nullable();
export const STRATEGY_METRICS = ['reach', 'views', 'saves', 'shares', 'replies', 'follows', 'profileVisits', 'linkVisits', 'productionMinutes'] as const;
const metrics = z.strictObject({ reach: count, views: count, saves: count, shares: count, replies: count, follows: count, profileVisits: count, linkVisits: count, productionMinutes: count });
export const StrategyResultInputSchema = StrategyScopeSchema.extend({
  publicationId: z.uuid(),
  publishedAt: z.iso.datetime({ offset: true }),
  observedAt: z.iso.datetime({ offset: true }),
  experiment: z.enum(['baseline', 'hook', 'threads', 'story']),
  variant: z.enum(['A', 'B']),
  evidence: z.string().trim().min(3).max(500),
  metrics,
}).refine((v) => Date.parse(v.observedAt) >= Date.parse(v.publishedAt), { message: 'observation-before-publication', path: ['observedAt'] })
  .refine((v) => STRATEGY_METRICS.some((key) => v.metrics[key] !== null), { message: 'measurement-required', path: ['metrics'] });
export type StrategyResultInput = z.infer<typeof StrategyResultInputSchema>;
export type StrategyMetrics = z.infer<typeof metrics>;
export const StrategyPublicationSchema = z.object({
  id: z.uuid(), revisionId: z.uuid(), title: z.string(), channel: z.enum(['instagram', 'threads', 'story']),
  format: z.string(), remoteUrl: z.url({ protocol: /^https$/ }).nullable(),
});
export type StrategyPublication = z.infer<typeof StrategyPublicationSchema>;
export const StrategyResultSchema = z.object({
  id: z.uuid(), publication_id: z.uuid(), published_at: z.iso.datetime({ offset: true }), observed_at: z.iso.datetime({ offset: true }),
  experiment: z.enum(['baseline', 'hook', 'threads', 'story']), variant: z.enum(['A', 'B']), evidence: z.string(), metrics,
});
export type StrategyResult = z.infer<typeof StrategyResultSchema>;
export const StrategyLinkSchema = z.object({ idea_id: z.string(), draft_id: z.uuid().nullable(), topic_id: z.uuid().nullable() });
export const StrategyReadSchema = z.object({
  links: z.array(StrategyLinkSchema).max(100), results: z.array(StrategyResultSchema).max(200),
  publications: z.array(StrategyPublicationSchema).max(300), partial: z.boolean(),
});
export type StrategyRead = z.infer<typeof StrategyReadSchema>;

/** Snapshot windows use owner-entered native publication times, never a scheduled slot. */
export function strategyAgeWindow(publishedAt: string, observedAt: string): '24h' | '72h' | '7d' | 'other' {
  const hours = (Date.parse(observedAt) - Date.parse(publishedAt)) / 3_600_000;
  return hours >= 23 && hours <= 25 ? '24h' : hours >= 70 && hours <= 76 ? '72h' : hours >= 156 && hours <= 180 ? '7d' : 'other';
}
export const strategyRate = (value: number | null, denominator: number | null) => value !== null && denominator !== null && denominator > 0 ? value / denominator * 1000 : null;

/** Comparable rows only. No automatic winner; small/manual observations remain descriptive. */
export function strategyComparison(read: StrategyRead, experiment: string, window: '72h' | '7d' | '24h', brand: 'devshark' | 'dneskai') {
  const posts = new Map(read.publications.map((p) => [p.id, p]));
  const groups = new Map<string, { channel: StrategyPublication['channel']; format: string; variant: 'A' | 'B'; rates: number[]; denominator: number }>();
  const seen = new Set<string>();
  for (const row of [...read.results].sort((a, b) => b.observed_at.localeCompare(a.observed_at))) {
    const post = posts.get(row.publication_id);
    if (!post || row.experiment !== experiment || strategyAgeWindow(row.published_at, row.observed_at) !== window) continue;
    if ((experiment === 'hook' && post.channel !== 'instagram') || (experiment === 'threads' && post.channel !== 'threads') || (experiment === 'story' && post.channel !== 'story')) continue;
    // One observation per publication and age window; repeated captures cannot inflate the sample.
    if (seen.has(row.publication_id)) continue;
    seen.add(row.publication_id);
    const denominator = post.channel === 'threads' ? row.metrics.views : row.metrics.reach;
    const key = `${post.channel}:${post.format}:${row.variant}`;
    const metric = post.channel === 'instagram' ? (experiment === 'hook' && brand === 'dneskai' ? 'saves' : 'shares') : 'replies';
    const rate = strategyRate(row.metrics[metric], denominator);
    if (rate === null) continue;
    const group = groups.get(key) ?? { channel: post.channel, format: post.format, variant: row.variant, rates: [], denominator: 0 };
    group.rates.push(rate); group.denominator += denominator!; groups.set(key, group);
  }
  return [...groups.values()].map(({ rates, ...group }) => {
    rates.sort((a, b) => a - b);
    const middle = Math.floor(rates.length / 2);
    return { ...group, sample: rates.length, median: rates.length % 2 ? rates[middle]! : (rates[middle - 1]! + rates[middle]!) / 2,
      sufficient: rates.length >= 4 && group.denominator >= 500 };
  });
}
