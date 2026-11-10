import { describe, expect, it } from 'vitest';
import { growthResearch, strategyDevsharkDraft, strategyIdeas } from '@/lib/marketing/strategy/content';
import { StrategyResultInputSchema, strategyAgeWindow, strategyComparison, strategyRate, type StrategyMetrics, type StrategyRead, type StrategyResult } from '@/lib/marketing/strategy/contracts';
import { layoutDevsharkSlide } from '@/lib/design-studio/devshark-layout';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const metrics: StrategyMetrics = { reach: null, views: null, saves: null, shares: null, replies: null, follows: null, profileVisits: null, linkVisits: null, productionMinutes: null };
const result = (n: number, patch: Partial<StrategyResult> = {}): StrategyResult => ({ id: id(n), publication_id: id(1), published_at: '2026-11-01T12:00:00Z', observed_at: '2026-11-04T12:00:00Z', experiment: 'hook', variant: 'A', evidence: 'Native Insights export', metrics: { ...metrics, reach: 100, saves: 2, shares: 4 }, ...patch });

describe('brand strategy evidence and production', () => {
  it('provides 25 distinct ideas per brand and renders the actual seeded devShark decks without layout errors', () => {
    for (const brand of ['dneskai', 'devshark'] as const) {
      const ideas = strategyIdeas(brand);
      expect(ideas).toHaveLength(25);
      expect(new Set(ideas.map((i) => i.id)).size).toBe(25);
      expect(growthResearch.brands[brand].pillars.reduce((sum, p) => sum + p.percent, 0)).toBe(100);
      for (const idea of ideas) {
        expect(idea.sourceUrl).toMatch(/^https:/);
        if (brand === 'devshark') {
          const draft = strategyDevsharkDraft(idea);
          for (const index of draft.deck.slides.keys()) expect(layoutDevsharkSlide(draft.deck, index, { finGreen: 'fin', finInk: 'fin', logoWhite: 'logo' }).warnings, idea.id).toEqual([]);
        }
      }
    }
  });
  it('keeps unknown and zero separate and refuses invalid counts or times', () => {
    expect(strategyRate(null, 100)).toBeNull(); expect(strategyRate(0, 100)).toBe(0); expect(strategyRate(10, 0)).toBeNull();
    const input = { projectId: id(1), brand: 'devshark', publicationId: id(2), publishedAt: '2026-11-01T12:00:00Z', observedAt: '2026-11-04T12:00:00Z', experiment: 'hook', variant: 'A', evidence: 'Insights', metrics };
    expect(StrategyResultInputSchema.safeParse(input).success).toBe(false);
    expect(StrategyResultInputSchema.safeParse({ ...input, metrics: { ...metrics, shares: 0 } }).success).toBe(true);
    expect(StrategyResultInputSchema.safeParse({ ...input, metrics: { ...metrics, reach: -1 } }).success).toBe(false);
    expect(StrategyResultInputSchema.safeParse({ ...input, metrics: { ...metrics, reach: 1.2 } }).success).toBe(false);
    expect(StrategyResultInputSchema.safeParse({ ...input, observedAt: '2026-10-01T12:00:00Z', metrics: { ...metrics, reach: 2 } }).success).toBe(false);
  });
  it('classifies snapshots from actual elapsed time, including DST transitions', () => {
    expect(strategyAgeWindow('2026-10-24T12:00:00+02:00', '2026-10-25T11:00:00+01:00')).toBe('24h');
    expect(strategyAgeWindow('2026-11-01T12:00:00Z', '2026-11-04T12:00:00Z')).toBe('72h');
    expect(strategyAgeWindow('2026-11-01T12:00:00Z', '2026-11-08T12:00:00Z')).toBe('7d');
    expect(strategyAgeWindow('2026-11-01T12:00:00Z', '2026-11-02T01:00:00Z')).toBe('other');
  });
  it('deduplicates repeated snapshots, separates channels and formats, and uses brand-specific primary metrics', () => {
    const read: StrategyRead = { links: [], partial: false, publications: [
      { id: id(1), revisionId: id(21), title: 'Test', channel: 'instagram', format: 'carousel', remoteUrl: null },
      { id: id(2), revisionId: id(22), title: 'Test', channel: 'threads', format: 'post', remoteUrl: null },
    ], results: [result(10), result(11, { observed_at: '2026-11-04T13:00:00Z', metrics: { ...metrics, reach: 200, saves: 10, shares: 6 } }), result(12, { publication_id: id(2), metrics: { ...metrics, views: 1000, replies: 8 } }), result(13, { publication_id: id(3) })] };
    expect(strategyComparison(read, 'hook', '72h', 'devshark')).toEqual([
      { channel: 'instagram', format: 'carousel', variant: 'A', sample: 1, median: 30, denominator: 200, sufficient: false },
    ]);
    expect(strategyComparison({ ...read, results: read.results.map((row) => ({ ...row, experiment: 'threads' })) }, 'threads', '72h', 'devshark')).toEqual([
      { channel: 'threads', format: 'post', variant: 'A', sample: 1, median: 8, denominator: 1000, sufficient: false },
    ]);
    expect(strategyComparison(read, 'hook', '72h', 'dneskai')[0]!.median).toBe(50);
    expect(strategyComparison(read, 'hook', '7d', 'dneskai')).toEqual([]);
  });
});
