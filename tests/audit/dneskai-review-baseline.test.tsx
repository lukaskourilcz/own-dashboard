// @vitest-environment happy-dom
/** Desired-behavior regressions derived from the original audit probes. */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
import { DneskaiAudioLibrary } from '@/components/marketing/dneskai-audio-library';
import { dneskaiLabOrder, dneskaiLabQueue } from '@/lib/marketing/dneskai-lab';
import { readDneskaiWorkspace } from '@/lib/marketing/dneskai-workspace-read';
import { deckRevision } from '../lib/marketing-dneskai-revision-fixture';

const owner = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-10-23T10:00:00Z');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Row = Record<string, unknown>;
/** Applies requested filters and limits, so a SQL limit cannot disappear inside a forgiving stub. */
function database(tables: Record<string, Row[]>) {
  return { from(table: string) {
    let result = [...(tables[table] ?? [])], limit = Infinity;
    const order: Array<{ key: string; ascending: boolean }> = [];
    const column = (key: string) => key === 'request->generation->source->>brand' ? 'brand' : key;
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { result = result.filter(r => r[column(key)] === value); return query; },
      neq: (key: string, value: unknown) => { result = result.filter(r => r[key] !== value); return query; },
      in: (key: string, values: unknown[]) => { result = result.filter(r => values.includes(r[key])); return query; },
      not: (key: string, operator: string, value: string) => { if (operator === 'in') result = result.filter(r => !value.slice(1, -1).split(',').includes(String(r[key]))); return query; },
      gte: (key: string, value: string) => { result = result.filter(r => String(r[key]) >= value); return query; },
      or: (filter: string) => { const match = /^created_at.lt.(.+),and\(created_at.eq.(.+),id.lt.(.+)\)$/.exec(filter)!; result = result.filter(r => String(r.created_at) < match[1]! || (r.created_at === match[2] && String(r.id) < match[3]!)); return query; },
      order: (key: string, options?: { ascending?: boolean }) => { order.push({ key, ascending: options?.ascending !== false }); return query; },
      limit: (count: number) => { limit = count; return query; },
      then: (resolve: (value: unknown) => unknown) => {
        result.sort((a,b) => { for (const by of order) { const cmp = String(a[by.key]).localeCompare(String(b[by.key])); if (cmp) return by.ascending ? cmp : -cmp; } return 0; });
        return Promise.resolve({ data: result.slice(0, limit), error: null }).then(resolve);
      },
    };
    return query;
  } } as never;
}
const row = (n: number, status = 'published'): Row => ({ id: id(n), user_id: owner, brand: 'dneskai', status, ready: true,
  content_hash: 'a'.repeat(64), created_at: '2026-10-23T08:00:00Z', replaces_id: null, approved_at: null, feedback: null, render_report: null,
  revision: { ...deckRevision(), scheduledAt: '2026-10-23T07:00:00Z' } });

describe('DNESKAi audit regressions', () => {
  it('C02: retains a pending decision behind 150 newer history revisions', async () => {
    const old = { ...row(999, 'review'), created_at: '2026-09-01T08:00:00Z', revision: { ...deckRevision(), scheduledAt: '2026-09-01T08:00:00Z' } };
    const control = await readDneskaiWorkspace(database({ marketing_revisions: [old] }), owner, now);
    expect(control.posts.map(p => p.id)).toContain(id(999));
    const newer = Array.from({ length: 150 }, (_, n) => {
      const at = new Date(now.getTime() - n * 6 * 3600_000).toISOString();
      const item = row(n + 1);
      return { ...item, created_at: at, revision: { ...(item.revision as Row), scheduledAt: at } };
    });
    const read = await readDneskaiWorkspace(database({ marketing_revisions: [...newer, old] }), owner, now);
    expect(read.unreadable).toBe(0);
    expect(read.posts.map(p => p.id)).toContain(id(999));
    expect(dneskaiLabOrder(dneskaiLabQueue(read, now.getTime())).map(item => item.post.id)).toContain(id(999));
  });
  it('C02: reaches every pending decision across stable keyset pages, including equal timestamps', async () => {
    const pending = Array.from({ length: 75 }, (_, n) => row(n + 1, 'review'));
    const db = database({ marketing_revisions: pending });
    const first = await readDneskaiWorkspace(db, owner, now);
    const second = await readDneskaiWorkspace(db, owner, now, undefined, { decisionsBefore: first.decisionPage!.nextCursor! });
    const third = await readDneskaiWorkspace(db, owner, now, undefined, { decisionsBefore: second.decisionPage!.nextCursor! });
    expect([first.posts.length, second.posts.length, third.posts.length]).toEqual([30, 30, 15]);
    expect(new Set([...first.posts, ...second.posts, ...third.posts].map(p => p.id)).size).toBe(75);
    expect(third.decisionPage!.nextCursor).toBeNull();
  });
  it('C03: filters other brands before the DNESKAi jobs limit', async () => {
    const job = (n: number, brand: string): Row => ({ id: id(n), user_id: owner, brand, status: 'queued', error_code: null,
      created_at: '2026-10-23T08:00:00Z', scheduled_at: '2026-10-23T16:00:00Z', revision_id: id(1000+n), title: 'Synthetic queued draft' });
    const target = { ...job(999, 'dneskai'), created_at: '2026-10-23T07:00:00Z' };
    expect((await readDneskaiWorkspace(database({ marketing_jobs: [target] }), owner, now)).jobs).toHaveLength(1);
    const read = await readDneskaiWorkspace(database({ marketing_jobs: [...Array.from({ length: 60 }, (_, n) => job(n + 1, 'devshark')), target] }), owner, now);
    expect(read.jobs).toHaveLength(1);
  });
  it('C04: maps complete database counts and keeps failures beyond the top ten codes', async () => {
    const post = row(1);
    post.revision = { ...(post.revision as Row), engagement: { keyword: 'SKILL', replyMessage: 'Synthetic reply.' } };
    const rpc = vi.fn(async () => ({ error: null, data: {
      receipts: [{ publicationId: id(2), commentsSeen: 6000, keywordMatches: 5001, privateSent: 5001, publicSent: 0, failedCount: 12,
        failures: Array.from({ length: 10 }, (_, n) => ({ code: `failure-${n}`, count: 1 })), lastCheckedAt: null }],
      summary: { posts: 2, commentsSeen: 7000, keywordMatches: 5101, privateSent: 5101, publicSent: 0, failed: 12 },
    } }));
    const db = Object.assign(database({ marketing_revisions: [post],
      marketing_publications: [{ id: id(2), user_id: owner, revision_id: id(1), status: 'published', scheduled_at: '2026-10-23T07:00:00Z', remote_url: null, error_code: null, last_checked_at: null }],
    }), { rpc });
    const read = await readDneskaiWorkspace(db, owner, now, undefined, { engagement: true });
    expect(read.posts[0]!.engagementReceipt?.keywordMatches).toBe(5001);
    expect(read.posts[0]!.engagementReceipt?.failedCount).toBe(12);
    expect(read.engagementSummary?.privateSent).toBe(5101);
    expect(read.engagementStatus).toBe('complete');
    expect(rpc).toHaveBeenCalledWith('marketing_dneskai_engagement_receipts', expect.objectContaining({ p_publication_ids: [id(2)] }));
  });
  it('C04: exposes unavailable aggregate data rather than reporting zero when the migration is absent', async () => {
    const db = Object.assign(database({}), { rpc: vi.fn(async () => ({ data: null, error: { code: 'PGRST202' } })) });
    const read = await readDneskaiWorkspace(db, owner, now, undefined, { engagement: true });
    expect(read.engagementSummary).toBeUndefined(); expect(read.engagementStatus).toBe('unavailable');
  });
  it('C05: gives every upload field a unique ID and an associated label', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ tracks: [] })));
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container), client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    try {
      await act(async () => { root.render(<QueryClientProvider client={client}><DneskaiAudioLibrary lang="en" /></QueryClientProvider>); });
      await act(async () => { for (let n = 0; n < 5; n++) await new Promise(resolve => setTimeout(resolve, 20)); });
      const form = container.querySelector('form')!;
      expect(form).not.toBeNull();
      const ids = [...form.querySelectorAll('[id]')].map(element => element.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(document.getElementById(form.getAttribute('aria-labelledby')!)?.tagName).toBe('H3');
      for (const label of form.querySelectorAll('label[for]')) {
        const target = document.getElementById((label as HTMLLabelElement).htmlFor);
        expect(target, label.textContent ?? '').not.toBeNull();
        expect(['INPUT', 'SELECT', 'TEXTAREA']).toContain(target!.tagName);
      }
    } finally { await act(async () => root.unmount()); container.remove(); client.clear(); vi.unstubAllGlobals(); }
  });
});
