import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { readDneskaiTopics } from '@/lib/marketing/dneskai-workspace-read';
import { DneskaiTopicActionSchema } from '@/lib/marketing/dneskai-topics';
import { dneskaiTopicsEnabled } from '@/lib/marketing/dneskai-evidence-rollout';

const owner = '11111111-1111-4111-8111-111111111111', project = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-10-23T08:00:00Z');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (n: number, patch: Record<string, unknown> = {}) => ({ id: id(n), kind: 'education', source_kind: 'instagram', title_cs: `Námět ${n}`, summary: null, keyword: 'prompt', verdict: null,
  evidence: { urls: ['https://www.example.test/reel/1'] }, status: 'proposed', proposed_for: '2026-10-23', approved_at: null, created_at: '2026-10-23T01:00:00+00:00', updated_at: '2026-10-23T01:00:00+00:00', ...patch });

/** A stand-in for the Supabase query builder: records each chain and answers the three reads in order. */
function fakeDb(results: Array<{ data: unknown[] | null; error: unknown }>) {
  const calls: Array<Array<[string, unknown[]]>> = [];
  const from = vi.fn((table: string) => {
    const chain: Array<[string, unknown[]]> = [['from', [table]]]; calls.push(chain);
    const result = results[calls.length - 1] ?? { data: [], error: null };
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'neq', 'in', 'not', 'gte', 'order', 'limit']) builder[method] = (...args: unknown[]) => { chain.push([method, args]); return builder; };
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
    return builder;
  });
  return { db: { from } as never, from, calls };
}

describe('readDneskaiTopics (#150)', () => {
  it('returns nothing and reads nothing with the switch off', async () => {
    const { db, from } = fakeDb([]);
    expect(await readDneskaiTopics(db, owner, project, now, { enabled: false })).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('groups topics by kind and status, scoped to the owner and project, and counts unreadable rows', async () => {
    const { db, calls } = fakeDb([
      { data: [row(1), row(2, { kind: 'news', status: 'approved', approved_at: '2026-10-23T06:00:00Z', evidence: { handle: 'itstundeanthony', urls: [] }, verdict: 'fact' }), row(3, { status: 'nonsense' })], error: null },
      { data: [row(4, { status: 'rejected', evidence: {} })], error: null },
      { data: [{ created_at: '2026-10-23T01:30:00+00:00' }], error: null },
    ]);
    const read = (await readDneskaiTopics(db, owner, project, now, { enabled: true }))!;
    expect(read.groups.education.proposed.map((topic) => topic.id)).toEqual([id(1)]);
    expect(read.groups.education.proposed[0]!.source).toEqual({ label: 'example.test', url: 'https://www.example.test/reel/1' });
    expect(read.groups.news.approved[0]).toMatchObject({ id: id(2), verdict: 'fact', source: { label: '@itstundeanthony', url: null } });
    expect(read.groups.education.rejected[0]).toMatchObject({ id: id(4), source: { label: null, url: null } });
    expect(read).toMatchObject({ schemaVersion: 'dneskai-topics/1', unreadable: 1, lastProposedAt: '2026-10-23T01:30:00.000Z' });
    for (const chain of calls) {
      expect(chain).toContainEqual(['eq', ['user_id', owner]]);
      expect(chain).toContainEqual(['eq', ['project_id', project]]);
      expect(chain.some(([method]) => method === 'limit')).toBe(true);
    }
    expect(calls[2]).toContainEqual(['neq', ['source_kind', 'manual']]);
  });

  it('fails the read when a query fails', async () => {
    const { db } = fakeDb([{ data: null, error: { message: 'x' } }, { data: [], error: null }, { data: [], error: null }]);
    await expect(readDneskaiTopics(db, owner, project, now, { enabled: true })).rejects.toThrow('dneskai-topics-unavailable');
  });
});

describe('DNESKAi topic actions and switch', () => {
  it('accepts the five actions and refuses malformed ones', () => {
    expect(DneskaiTopicActionSchema.safeParse({ action: 'approve', projectId: project, topicIds: [id(1), id(2)] }).success).toBe(true);
    expect(DneskaiTopicActionSchema.safeParse({ action: 'edit', projectId: project, topicId: id(1), title: 'Titulek', keyword: null }).success).toBe(true);
    expect(DneskaiTopicActionSchema.safeParse({ action: 'create', projectId: project, kind: 'news', url: 'https://example.test/a' }).success).toBe(true);
    expect(DneskaiTopicActionSchema.safeParse({ action: 'create', projectId: project, kind: 'news' }).success).toBe(false);
    expect(DneskaiTopicActionSchema.safeParse({ action: 'create', projectId: project, kind: 'news', url: 'http://example.test/a' }).success).toBe(false);
    expect(DneskaiTopicActionSchema.safeParse({ action: 'edit', projectId: project, topicId: id(1), title: 'T', keyword: 'dvě slova' }).success).toBe(false);
    expect(DneskaiTopicActionSchema.safeParse({ action: 'approve', projectId: project, topicIds: [] }).success).toBe(false);
    expect(DneskaiTopicActionSchema.safeParse({ action: 'approve', projectId: project, topicIds: Array.from({ length: 41 }, (_, n) => id(n)) }).success).toBe(false);
    expect(DneskaiTopicActionSchema.safeParse({ action: 'publish', projectId: project, topicIds: [id(1)] }).success).toBe(false);
  });
  it('is on only for exactly "true"', () => {
    expect(dneskaiTopicsEnabled({})).toBe(false);
    expect(dneskaiTopicsEnabled({ DNESKAI_TOPICS_ENABLED: '1' })).toBe(false);
    expect(dneskaiTopicsEnabled({ DNESKAI_TOPICS_ENABLED: 'true' })).toBe(true);
  });
});
