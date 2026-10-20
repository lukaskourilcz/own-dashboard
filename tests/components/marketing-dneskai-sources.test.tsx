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
  it.each(['en', 'cs'] as const)('separates source publication, last successful check and import time, and labels estimates (%s)', lang => {
    const value = state(); const t = dneskaiSources[lang]; const candidate = value.candidates[0];
    value.candidates = [{ ...candidate, publishedAt: '2026-10-12T11:59:59Z', dateEstimated: true, fetchedAt: '2026-10-12T20:05:00Z' }, { ...candidate, id: 'older', status: 'held', targetDate: null, publishedAt: '2026-10-10T08:00:00+02:00', fetchedAt: '2026-10-10T20:05:00Z' }];
    value.sourceStates[0] = { ...value.sourceStates[0], errorCode: 'collection-source-item-cap' };
    render(<DneskaiSourceRecords state={value} lang={lang} now={now} />);
    for (const text of [t.success, t.newestPublished, t.lastImport, t.importedAt, `(${t.estimated})`, t.blockers['collection-source-item-cap']]) expect(container.textContent).toContain(text);
    // A capped read is informational, not an error.
    const capNote = [...container.querySelectorAll('p')].find(node => node.textContent === t.blockers['collection-source-item-cap']);
    expect(capNote?.className).toContain('text-foreground-muted'); expect(capNote?.className).not.toContain('text-risk');
    for (const instant of ['2026-10-12T11:59:59Z', '2026-10-12T20:05:00Z', '2026-10-11T20:00:00Z']) expect(container.querySelector(`time[datetime="${instant}"]`), instant).not.toBeNull();
    expect(container.querySelector('time[datetime="2026-10-10T20:05:00Z"]')).toBeNull();
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
    value.candidates.push({ ...candidate, id: 'old', title: 'OLD-SELECTION', targetDate: '2026-10-12' }, { ...candidate, id: 'unknown', title: 'UNASSOCIATED-SELECTION', targetDate: null });
    value.runs[0].selectedCount = 4;
    render(<DneskaiSourceRecords state={value} lang="en" now={now} />);
    expect(container.textContent).toContain('Selected topics: 1 / 4'); expect(container.textContent).toContain(dneskaiSources.en.pendingTopics);
    expect(container.textContent).not.toContain('OLD-SELECTION'); expect(container.textContent).not.toContain('UNASSOCIATED-SELECTION');
    const tomorrow = container.querySelector('[aria-labelledby="dneskai-tomorrow-title"]'); expect(tomorrow?.textContent).not.toContain('4 / 4');
  });
  it.each(['en', 'cs'] as const)('keeps last night’s four research topics visible after Prague midnight and the next morning (%s)', lang => {
    const value = state(); const candidate = value.candidates[0];
    value.candidates = Array.from({ length: 4 }, (_, index) => ({ ...candidate, id: `midnight-${index}`, title: `MIDNIGHT-TOPIC-${index}`, targetDate: '2026-10-14' }));
    value.runs[0].selectedCount = 4;
    render(<DneskaiSourceRecords state={value} lang={lang} now={new Date('2026-10-13T21:59:59Z')} />);
    expect(container.querySelector('[aria-labelledby="dneskai-tomorrow-title"]')?.textContent).toContain('4 / 4');
    expect(container.querySelector('[aria-labelledby="dneskai-today-title"]')?.textContent).not.toContain('MIDNIGHT-TOPIC');
    for (const instant of ['2026-10-13T22:00:00Z', '2026-10-14T07:00:00Z']) {
      render(<DneskaiSourceRecords state={value} lang={lang} now={new Date(instant)} />);
      const today = container.querySelector('[aria-labelledby="dneskai-today-title"]'); const tomorrow = container.querySelector('[aria-labelledby="dneskai-tomorrow-title"]');
      expect(today?.textContent).toContain(dneskaiSources[lang].todayTopics); expect(today?.textContent).toContain('4 / 4');
      for (let index = 0; index < 4; index++) expect(today?.textContent).toContain(`MIDNIGHT-TOPIC-${index}`);
      expect(tomorrow?.textContent).toContain('0 / 4'); expect(tomorrow?.textContent).not.toContain('MIDNIGHT-TOPIC');
      expect(today?.querySelectorAll('li')).toHaveLength(4); expect(today?.textContent).toContain(dneskaiSources[lang].unpublished);
      expect(container.querySelectorAll('button,input,img')).toHaveLength(0);
    }
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
describe('DNESKAi events in Sources (#115)', () => {
  const member = (id: string, role: 'primary' | 'supporting', patch: Record<string, unknown> = {}) => ({ candidateId: id, sourceId: 'qa-rss', title: `EVENT-${id}`, url: `https://example.invalid/${id}`, status: 'selected' as const, reason: null, role, ...patch });
  function withEvents(): DneskaiCollectionState {
    const value = state();
    value.events = [
      { eventId: 'b'.repeat(64), targetDate: '2026-10-14', status: 'selected', reason: null, brief: { id: '22222222-2222-4222-8222-222222222222', rank: 2, status: 'pending', code: 'account-unavailable', scheduledAt: '2026-10-14T10:30:00.000Z', suggestedFormat: 'carousel', evidenceCount: 1, mediaCount: 0, jobId: null }, members: [member('second', 'primary')] },
      { eventId: 'a'.repeat(64), targetDate: '2026-10-14', status: 'selected', reason: null, brief: { id: '11111111-1111-4111-8111-111111111111', rank: 1, status: 'queued', code: null, scheduledAt: '2026-10-14T06:00:00.000Z', suggestedFormat: 'carousel', evidenceCount: 2, mediaCount: 3, jobId: '33333333-3333-4333-8333-333333333333' }, members: [member('first', 'primary'), member('first-support', 'supporting', { title: 'SUPPORTING-REPORT' })] },
      { eventId: 'c'.repeat(64), targetDate: null, status: 'duplicate', reason: 'collection-already-covered', brief: null, members: [member('covered', 'primary', { status: 'duplicate' }), member('covered-2', 'supporting', { status: 'duplicate' })] },
      { eventId: 'd'.repeat(64), targetDate: null, status: 'held', reason: 'PRIVATE-REASON-CODE', brief: null, members: [member('held', 'primary', { status: 'held' })] },
    ];
    return value;
  }
  it.each(['en', 'cs'] as const)('lists tomorrow’s events in rank order with primary, supporting reports, brief state and slot (%s)', lang => {
    const t = dneskaiSources[lang];
    render(<DneskaiSourceRecords state={withEvents()} lang={lang} now={now} />);
    const tomorrow = container.querySelector('[aria-labelledby="dneskai-tomorrow-title"]')!;
    expect(tomorrow.textContent).toContain('2 / 4');
    const items = [...tomorrow.querySelectorAll(':scope ol > li')];
    expect(items.map(item => item.querySelector('a')?.textContent)).toEqual(['EVENT-first', 'EVENT-second']);
    expect(items[0]!.textContent).toContain(t.primarySource); expect(items[0]!.textContent).toContain(t.briefQueued);
    expect(items[0]!.querySelector(`ul[aria-label="${t.supportingReports}"]`)?.textContent).toContain('SUPPORTING-REPORT');
    expect(items[1]!.textContent).toContain(t.briefAccount);
    expect(items[0]!.querySelector('time[datetime="2026-10-14T06:00:00.000Z"]')).not.toBeNull();
    // The flat candidate list is replaced, not shown in addition.
    expect(tomorrow.textContent).not.toContain('Offline research only');
  });
  it.each(['en', 'cs'] as const)('explains held and duplicate events in words, never in codes (%s)', lang => {
    const t = dneskaiSources[lang];
    render(<DneskaiSourceRecords state={withEvents()} lang={lang} now={now} />);
    const others = container.querySelector('[aria-labelledby="dneskai-events-title"]')!;
    expect(others.textContent).toContain(t.otherEvents);
    expect(others.textContent).toContain(t.eventStatus.duplicate); expect(others.textContent).toContain(t.eventReasons['collection-already-covered']);
    expect(others.textContent).toContain(`${t.reports}: 2`);
    expect(others.textContent).toContain(t.eventStatus.held); expect(others.textContent).toContain(t.reasonUnknown);
    expect(container.textContent).not.toContain('PRIVATE-REASON-CODE'); expect(container.textContent).not.toContain('collection-already-covered');
    expect(container.querySelectorAll('img,button,input')).toHaveLength(0);
  });
  it('keeps EN and CS event strings in parity', () => {
    expect(Object.keys(dneskaiSources.cs.eventReasons).sort()).toEqual(Object.keys(dneskaiSources.en.eventReasons).sort());
    expect(Object.keys(dneskaiSources.cs.eventStatus).sort()).toEqual(Object.keys(dneskaiSources.en.eventStatus).sort());
  });
});
