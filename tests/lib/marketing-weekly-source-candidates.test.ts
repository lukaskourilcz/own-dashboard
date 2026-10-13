import { describe, expect, it, vi } from 'vitest';
import { planningSourceCandidates } from '@/lib/marketing/weekly-source-candidates';
import { parseSourcePacket } from '@/lib/marketing/contracts';
import heldQuestion from '../../templates/marketing/benchmarks/devshark-question.json';
import heldTask from '../../templates/marketing/benchmarks/devshark-coding-task.json';
import heldArticle from '../../templates/marketing/benchmarks/dneskai-article.json';
vi.mock('server-only', () => ({}));
const now = new Date('2026-10-18T05:00:00Z');
function simulation(value: unknown) {
  const packet = parseSourcePacket(value);
  return { ...packet, eligible: true, eligibilityReason: 'OFFLINE WEEKLY SOURCE SELECTION SIMULATION ONLY', observedAt: now.toISOString(), expiresAt: null };
}
describe('source candidates retain producer eligibility/hash/kind boundaries', () => {
  it('never changes retained held packets and restricts each brand to authored source kinds', () => {
    const fixtures = [heldQuestion, heldTask, heldArticle].map(parseSourcePacket);
    expect(planningSourceCandidates(fixtures, 'devshark', now)).toEqual([]); expect(planningSourceCandidates(fixtures, 'dneskai', now)).toEqual([]);
    const candidates = fixtures.map(simulation), before = structuredClone(candidates);
    expect(planningSourceCandidates(candidates, 'devshark', now).map(packet => packet.kind)).toEqual(['question', 'coding-task']);
    expect(planningSourceCandidates(candidates, 'dneskai', now).map(packet => packet.kind)).toEqual(['article']);
    expect(candidates).toEqual(before); expect(fixtures.every(packet => !packet.eligible)).toBe(true);
  });
  it('excludes expired, withdrawn, hash-forged, presentation-only and future-observed packets', () => {
    const source = simulation(heldQuestion);
    for (const mutation of [{ eligible: false }, { expiresAt: now.toISOString() }, { contentHash: '0'.repeat(64) }, { kind: 'instagram-reference' as const }, { observedAt: '2026-10-19T05:00:00Z' }])
      expect(planningSourceCandidates([{ ...source, ...mutation }], 'devshark', now)).toEqual([]);
    expect(() => planningSourceCandidates([source, source], 'devshark', now)).toThrow('duplicate-planning-source');
  });
});
