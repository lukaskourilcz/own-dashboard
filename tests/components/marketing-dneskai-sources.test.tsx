// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DneskaiSources, DneskaiSourceRecords } from '@/components/marketing/dneskai-sources';
import { dneskaiSources } from '@/lib/i18n/sections/dneskai-sources';
import type { DneskaiCollectionState } from '@/lib/marketing/dneskai-contracts';
vi.mock('@/lib/i18n', () => ({ useLang: () => ({ lang: 'en' }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement; let root: Root; let client: QueryClient;
const now = new Date('2026-10-13T12:00:00Z');
function state(): DneskaiCollectionState {
  return { schemaVersion: 'dneskai-collection/1', timeZone: 'Europe/Prague', localTime: '22:00', dailyTarget: 4, approvalRequired: true, enabled: true, blockers: [],
    sources: [{ id: 'qa-rss', name: 'Offline QA feed', url: 'https://example.invalid/feed', kind: 'rss', weekdays: [2, 4], maxItems: 10 }],
    sourceStates: [{ sourceId: 'qa-rss', lastAttemptAt: '2026-10-13T10:00:00Z', lastSuccessAt: '2026-10-11T20:00:00Z', status: 'partial', errorCode: 'PRIVATE-ERROR', itemCount: 2, costUsd: null }],
    candidates: [{ id: 'qa-candidate', sourceId: 'qa-rss', externalId: 'qa', title: 'Offline research only', text: 'Not a verified publication', url: 'https://example.invalid/article', publishedAt: null, fetchedAt: now.toISOString(), mediaUrls: ['https://private.example.invalid/image.jpg'], contentHash: 'a'.repeat(64), category: 'ai-news', relevance: 0.9, duplicateOf: null, status: 'selected', targetDate: '2026-10-14', reason: null }],
    runs: [{ id: 'qa-run', date: '2026-10-13', targetDate: '2026-10-14', status: 'partial', selectedCount: 1, costUsd: null, errorCode: 'PRIVATE-ERROR' }] };
}
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); });
afterEach(() => { act(() => root.unmount()); container.remove(); client.clear(); vi.unstubAllGlobals(); });
const render = (node: React.ReactNode) => act(() => root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
describe('read-only DNESKAi source checks', () => {
  it.each(['en', 'cs'] as const)('shows real partial evidence, full-success date, unknown costs and research status (%s)', lang => {
    render(<DneskaiSourceRecords state={state()} lang={lang} now={now} />); const t = dneskaiSources[lang];
    for (const text of [t.today, t.registry, t.partial, t.success, t.unknownCost, t.unpublished, t.unknownPublished, '1 / 4']) expect(container.textContent).toContain(text);
    expect(container.querySelector('time[datetime="2026-10-11T20:00:00Z"]')).not.toBeNull();
    expect(container.querySelector('time[datetime="2026-10-13T20:00:00.000Z"]')).not.toBeNull();
    expect(container.querySelectorAll('img,iframe,video')).toHaveLength(0); expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.textContent).not.toContain('PRIVATE-ERROR'); expect(container.textContent).not.toContain('$0');
  });
  it('shows missing configuration and no scheduled checks without inventing a successful empty run', () => {
    const value = state(); value.enabled = false; value.blockers = ['collection-bridge-unconfigured']; value.sourceStates = []; value.candidates = []; value.runs = [];
    render(<DneskaiSourceRecords state={value} lang="en" now={now} />);
    expect(container.textContent).toContain(dneskaiSources.en.disabled); expect(container.textContent).toContain(dneskaiSources.en.notScheduled);
    expect(container.textContent).toContain(dneskaiSources.en.noRuns); expect(container.textContent).toContain(dneskaiSources.en.noTopics);
    expect(container.textContent).not.toContain('Complete');
  });
  it('counts only actual tomorrow candidates, holding old and unassociated selections', () => {
    const value = state(); const candidate = value.candidates[0];
    value.candidates.push({ ...candidate, id: 'old', title: 'OLD-SELECTION', targetDate: '2026-10-13' }, { ...candidate, id: 'unknown', title: 'UNASSOCIATED-SELECTION', targetDate: null });
    value.runs[0].selectedCount = 4;
    render(<DneskaiSourceRecords state={value} lang="en" now={now} />);
    expect(container.textContent).toContain('Selected topics: 1 / 4'); expect(container.textContent).toContain(dneskaiSources.en.pendingTopics);
    expect(container.textContent).not.toContain('OLD-SELECTION'); expect(container.textContent).not.toContain('UNASSOCIATED-SELECTION');
    const tomorrow = container.querySelector('[aria-labelledby="dneskai-tomorrow-title"]'); expect(tomorrow?.textContent).not.toContain('4 / 4');
  });
  it('leaves unsafe URLs as text and never loads remote candidate images', () => {
    const value = state(); value.sources[0].url = 'javascript:alert(1)'; value.candidates[0].url = 'https://user:secret@example.invalid';
    render(<DneskaiSourceRecords state={value} lang="en" now={now} />); expect(container.querySelectorAll('a,img')).toHaveLength(0);
  });
  it('loads nothing in public preview and exposes only final Marketing navigation', () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); render(<DneskaiSources projectId="qa-project" lang="cs" disabled />);
    expect(fetcher).not.toHaveBeenCalled(); expect(container.textContent).toContain(dneskaiSources.cs.preview);
    expect(container.querySelector('button')?.disabled).toBe(true); expect(container.querySelector('a')?.getAttribute('href')).toBe('/marketing');
    expect(container.querySelectorAll('input,select,textarea,img')).toHaveLength(0);
  });
  it('shows loading and a truthful read-only error without exposing server detail', async () => {
    let resolve!: (response: Response) => void; const fetcher = vi.fn<(url: unknown, options?: RequestInit) => Promise<Response>>(() => new Promise<Response>(done => { resolve = done; })); vi.stubGlobal('fetch', fetcher);
    render(<DneskaiSources projectId="qa-project" lang="en" />); expect(container.textContent).toContain(dneskaiSources.en.loading);
    await act(async () => { resolve(Response.json({ secret: 'PRIVATE-SERVER-DETAIL' }, { status: 403 })); await new Promise(done => setTimeout(done, 20)); });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(dneskaiSources.en.unavailable); expect(container.textContent).not.toContain('PRIVATE-SERVER-DETAIL');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0]?.[1]).not.toHaveProperty('method');
  });
});
