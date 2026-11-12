import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { refreshSource, refreshMarketingSources } from '@/lib/marketing/source-refresh';
import { devsharkDraftPacket } from '@/lib/marketing/devshark-source';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => { throw new Error('no admin client in tests'); } }));

const now = new Date('2026-11-13T09:00:00Z');
const owner = '00000000-0000-4000-8000-000000000001';
const concepts = JSON.parse(readFileSync('content/devshark/concepts-2026-11-07.json', 'utf8')) as Array<{ title: string; caption: string; deck: never }>;
const draft = (index: number, status = 'planned') => ({ id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`, title: concepts[index % concepts.length]!.title,
  caption: concepts[index % concepts.length]!.caption, deck: concepts[index % concepts.length]!.deck, status });

/** A synthetic owner-scoped concept store; it records every filter so the test can check owner scoping. */
function store(rows: Array<ReturnType<typeof draft> & { user_id?: string }>, options: { fail?: boolean } = {}) {
  const calls: Array<Array<[string, unknown]>> = [];
  const db = { from: (table: string) => {
    expect(table).toBe('marketing_devshark_drafts');
    const filters: Array<[string, unknown]> = []; calls.push(filters);
    let limit = Infinity;
    const scoped = () => rows.filter(row => (row.user_id ?? owner) === filters.find(([key]) => key === 'user_id')?.[1]
      && filters.every(([key, value]) => key === 'user_id' || (key === 'status:in' ? (value as string[]).includes(row.status) : key === 'id' ? row.id === value : true)));
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return chain; },
      in: (key: string, value: unknown) => { filters.push([`${key}:in`, value]); return chain; },
      order: () => chain,
      limit: (value: number) => { limit = value; return chain; },
      maybeSingle: async () => options.fail ? { data: null, error: { message: 'down' } } : { data: scoped()[0] ?? null, error: null },
      then: (resolve: (value: unknown) => void) => resolve(options.fail ? { data: null, error: { message: 'down' } } : { data: scoped().slice(0, limit).map(({ user_id: _owner, ...row }) => row), error: null }),
    };
    return chain;
  } };
  return { db: db as never, calls };
}

describe('local devShark source discovery (13 November 2026)', () => {
  it('discovers the owner\'s approved, planned and published concepts without any network request', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const { db, calls } = store([draft(0, 'approved'), draft(1, 'planned'), draft(2, 'published'), draft(3, 'draft'), draft(4, 'rejected'), { ...draft(5), user_id: '00000000-0000-4000-8000-000000000002' }]);
    const result = await refreshMarketingSources({ brand: 'devshark', owner, db, now });
    expect(fetcher).not.toHaveBeenCalled(); fetcher.mockRestore();
    expect(result.packets.map(packet => packet.sourceId)).toEqual([0, 1, 2].map(index => `devshark-draft:${draft(index).id}`));
    expect(result.packets.every(packet => packet.eligible && packet.kind === 'coding-task')).toBe(true);
    expect(result).toMatchObject({ held: [], dropped: 0, nextCursor: null });
    expect(calls[0]).toContainEqual(['user_id', owner]);
  });

  it('caps a discovery at 20 concepts', async () => {
    const { db } = store(Array.from({ length: 25 }, (_, index) => draft(index)));
    expect((await refreshMarketingSources({ brand: 'devshark', owner, db, now })).packets).toHaveLength(20);
  });

  it('reports a dated discovery as having no daily edition and reads nothing', async () => {
    const { db, calls } = store([draft(0)]);
    const result = await refreshMarketingSources({ brand: 'devshark', owner, db, now, date: '2026-11-13' });
    expect(result.packets).toEqual([]); expect(result.noEditionDates).toEqual(['2026-11-13']); expect(calls).toHaveLength(0);
  });

  it('requires an owner and fails closed when the concept store is unavailable', async () => {
    await expect(refreshMarketingSources({ brand: 'devshark', now })).rejects.toThrow('concept-owner-required');
    await expect(refreshMarketingSources({ brand: 'devshark', owner, db: store([], { fail: true }).db, now })).rejects.toThrow('source-current-unavailable');
  });

  it('holds a legacy non-concept devShark id without a request', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const result = await refreshMarketingSources({ brand: 'devshark', owner, db: store([]).db, sourceIds: ['question:legacy-daily'], now });
    expect(fetcher).not.toHaveBeenCalled(); fetcher.mockRestore();
    expect(result.packets).toEqual([]); expect(result.held).toEqual([{ sourceId: 'question:legacy-daily', reason: 'source-unavailable' }]);
  });

  it('re-reads a concept for the publisher and follows its current status', async () => {
    const packet = devsharkDraftPacket(draft(0), now);
    expect(await refreshSource(packet, new AbortController().signal, { owner, db: store([draft(0)]).db, now })).toEqual(packet);
    const rejected = await refreshSource(packet, new AbortController().signal, { owner, db: store([draft(0, 'rejected')]).db, now });
    expect(rejected.eligible).toBe(false);
    await expect(refreshSource(packet, new AbortController().signal, { owner, db: store([]).db, now })).rejects.toThrow('source-recheck-unavailable');
  });
});

describe('DNESKAi source refresh without Quorum', () => {
  it('holds a non-brief DNESKAi id locally and makes no request', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    for (const id of ['2026-10-12-qa-only', 'daily-web-article']) {
      const refreshed = await refreshMarketingSources({ brand: 'dneskai', sourceIds: [id], now });
      expect(refreshed.packets).toEqual([]); expect(refreshed.held).toEqual([{ sourceId: id, reason: 'source-unavailable' }]);
    }
    expect(fetcher).not.toHaveBeenCalled(); fetcher.mockRestore();
  });
});
