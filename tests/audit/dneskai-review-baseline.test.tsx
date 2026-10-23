// @vitest-environment happy-dom
/** Audit probes: assert observed baseline defects, not desired regression behavior. Remove/invert when fixed. */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
import { DneskaiAudioLibrary } from '@/components/marketing/dneskai-audio-library';
import { readDneskaiWorkspace } from '@/lib/marketing/dneskai-workspace-read';
import { deckRevision } from '../lib/marketing-dneskai-revision-fixture';

const owner = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-10-23T10:00:00Z');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Row = Record<string, unknown>;
/** Applies requested filters and limits, so a SQL limit cannot disappear inside a forgiving stub. */
function database(tables: Record<string, Row[]>) {
  return { from(table: string) {
    let result = [...(tables[table] ?? [])];
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { result = result.filter(r => r[key] === value); return query; },
      neq: (key: string, value: unknown) => { result = result.filter(r => r[key] !== value); return query; },
      in: (key: string, values: unknown[]) => { result = result.filter(r => values.includes(r[key])); return query; },
      gte: (key: string, value: string) => { result = result.filter(r => String(r[key]) >= value); return query; },
      order: () => query, // input rows are already newest first
      limit: (count: number) => { result = result.slice(0, count); return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: result, error: null }).then(resolve),
    };
    return query;
  } } as never;
}
const row = (n: number, status = 'published'): Row => ({ id: id(n), user_id: owner, brand: 'dneskai', status, ready: true,
  content_hash: 'a'.repeat(64), created_at: '2026-10-23T08:00:00Z', replaces_id: null, approved_at: null, feedback: null, render_report: null,
  revision: { ...deckRevision(), scheduledAt: '2026-10-23T07:00:00Z' } });

describe('DNESKAi audit: observed baseline defects', () => {
  it('C02: loses a pending decision behind 150 newer eligible revisions', async () => {
    const old = row(999, 'review');
    const control = await readDneskaiWorkspace(database({ marketing_revisions: [old] }), owner, now);
    expect(control.posts.map(p => p.id)).toContain(id(999));
    const read = await readDneskaiWorkspace(database({ marketing_revisions: [...Array.from({ length: 150 }, (_, n) => row(n + 1)), old] }), owner, now);
    expect(read.unreadable).toBe(0);
    expect(read.posts.map(p => p.id)).not.toContain(id(999));
  });
  it('C03: other brands fill the jobs limit before the DNESKAi filter', async () => {
    const job = (n: number, brand: string): Row => ({ id: id(n), user_id: owner, brand, status: 'queued', error_code: null,
      created_at: '2026-10-23T08:00:00Z', scheduled_at: '2026-10-23T16:00:00Z', revision_id: id(1000+n), title: 'Synthetic queued draft' });
    const target = job(999, 'dneskai');
    expect((await readDneskaiWorkspace(database({ marketing_jobs: [target] }), owner, now)).jobs).toHaveLength(1);
    const read = await readDneskaiWorkspace(database({ marketing_jobs: [...Array.from({ length: 60 }, (_, n) => job(n + 1, 'devshark')), target] }), owner, now);
    expect(read.jobs).toHaveLength(0);
  });
  it('C04: reports only 5000 of 5001 keyword matches as an exact receipt', async () => {
    const post = row(1);
    post.revision = { ...(post.revision as Row), engagement: { keyword: 'SKILL', replyMessage: 'Synthetic reply.' } };
    const read = await readDneskaiWorkspace(database({ marketing_revisions: [post],
      marketing_publications: [{ id: id(2), user_id: owner, revision_id: id(1), status: 'published', scheduled_at: '2026-10-23T07:00:00Z', remote_url: null, error_code: null, last_checked_at: null }],
      marketing_instagram_comment_replies: Array.from({ length: 5001 }, () => ({ user_id: owner, publication_id: id(2), status: 'sent', public_status: 'sent', error_code: null })),
    }), owner, now, undefined, { engagement: true });
    expect(read.posts).toHaveLength(1);
    expect(read.posts[0]!.engagementReceipt?.keywordMatches).toBe(5000);
    expect(read.engagementSummary?.privateSent).toBe(5000);
  });
  it('C05: renders a duplicate title ID that resolves the input label to a heading', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ tracks: [] })));
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container), client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    try {
      await act(async () => { root.render(<QueryClientProvider client={client}><DneskaiAudioLibrary lang="en" /></QueryClientProvider>); });
      await act(async () => { for (let n = 0; n < 5; n++) await new Promise(resolve => setTimeout(resolve, 20)); });
      const form = container.querySelector('form')!;
      expect(form).not.toBeNull();
      const heading = form.querySelector('h3')!;
      const duplicates = [...form.querySelectorAll('[id]')].filter(element => element.id === heading.id);
      expect(duplicates.map(element => element.tagName)).toEqual(['H3', 'INPUT']);
      const label = [...form.querySelectorAll('label')].find(element => element.htmlFor === heading.id)!;
      expect(document.getElementById(label.htmlFor)?.tagName).toBe('H3');
    } finally { await act(async () => root.unmount()); container.remove(); client.clear(); vi.unstubAllGlobals(); }
  });
});
