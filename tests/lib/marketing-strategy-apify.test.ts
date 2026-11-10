import { describe, expect, it } from 'vitest';
import plan from '@/lib/marketing/strategy/apify.json';
import sample from '../../docs/reports/2026-11-10-apify-strategy-sample.json';

describe('Apify research evidence', () => {
  it('reconciles the displayed coverage with dated, normalized source rows', () => {
    const expected = new Set(plan.cohort.map((row) => row.handle));
    const inScope = sample.rows.filter((row) => expected.has(row.handle));
    const cutoff = Date.parse(sample.recentWindowStart);
    const end = Date.parse(sample.recentWindowEnd);
    const recent = inScope.filter((row) => row.publishedAt && Date.parse(row.publishedAt) >= cutoff && Date.parse(row.publishedAt) <= end);
    expect(sample.rows).toHaveLength(sample.reportedResults);
    expect(new Set(sample.rows.map((row) => row.url)).size).toBe(sample.rows.length);
    expect([recent.length, inScope.length - recent.length, sample.rows.length - inScope.length]).toEqual(plan.quality.map((row) => row.value));
    expect(inScope.filter((row) => row.likes === null)).toHaveLength(34);
    expect(recent.filter((row) => row.format === 'Sidecar')).toHaveLength(2);
    expect(sample.rows.every((row) => row.likes === null || row.likes >= 0)).toBe(true);
    for (const cohort of plan.cohort) {
      expect(inScope.filter((row) => row.handle === cohort.handle)).toHaveLength(cohort.posts);
      expect(recent.filter((row) => row.handle === cohort.handle)).toHaveLength(cohort.recent45d);
    }
  });
  it('accounts for the proposed ceiling and excludes unrelated runs from brand evidence', () => {
    expect(plan.phases.reduce((sum, phase) => sum + phase.capUsd, 0)).toBe(plan.proposedCeilingUsd);
    expect(plan.runs.filter((run) => run.inScope === true).map((run) => run.url)).toEqual([sample.sourceRunUrl]);
    for (const id of ['USynCtwTktUfpRqKr', 'ONmrwMdL0llkSGxoE']) expect(plan.runs.find((run) => run.url.endsWith(id))!.inScope).toBe(false);
    // The report intentionally stores no raw text, commenter identities, cookies or signed CDN assets.
    const allowed = new Set(['handle', 'url', 'publishedAt', 'format', 'likes', 'comments', 'slides', 'plays']);
    expect(sample.rows.every((row) => Object.keys(row).every((key) => allowed.has(key)))).toBe(true);
  });
});
