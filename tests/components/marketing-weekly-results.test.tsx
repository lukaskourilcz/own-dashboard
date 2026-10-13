// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WeeklyResults, weeklyRecordedResults, type WeeklyResultsProps } from '@/components/marketing/weekly-results';
import type { MarketingRevisionRow, PublicationRow } from '@/lib/marketing/contracts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement; let root: Root;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// Test-only operational metadata, not measured Meta values or production publishing proof.
const revision = (n: number, scheduledAt = '2026-10-25T23:30:00Z', brand = 'devshark', platform = 'instagram') => ({ id: uuid(n), revision: { brand, scheduledAt, account: { platform }, caption: 'PRIVATE-COPY', sources: [{ content: 'PRIVATE-SOURCE' }] } }) as unknown as MarketingRevisionRow;
const publication = (n: number, status: PublicationRow['status'] = 'published', platform: PublicationRow['platform'] = 'instagram'): PublicationRow => ({ id: uuid(n + 100), revision_id: uuid(n), platform, status,
  remote_media_id: status === 'published' ? `test-media-${n}` : null, remote_url: status === 'published' ? `https://www.instagram.com/p/test-only-${n}` : null, remote_container_id: null, error_code: 'PRIVATE-ERROR' });
const props = (patch: Partial<WeeklyResultsProps> = {}): WeeklyResultsProps => ({ revisions: [], publications: [], weekStartsOn: '2026-10-25', now: new Date('2026-11-01T10:00:00Z'), lang: 'en', ...patch });
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
const render = (input: WeeklyResultsProps) => act(() => root.render(<WeeklyResults {...input} />));

describe('weekly review of bounded persisted outcomes', () => {
  it('uses Prague calendar bounds across DST and half-open boundaries, not UTC date substrings', () => {
    const input = props({ revisions: [revision(1, '2026-10-24T22:00:00Z'), revision(2, '2026-10-25T23:30:00Z'), revision(3, '2026-10-31T23:00:00Z'), revision(4, '2026-10-24T21:59:59Z')], publications: [1, 2, 3, 4].map(n => publication(n)) });
    const result = weeklyRecordedResults(input);
    expect(result.window.dates).toHaveLength(7); expect((Date.parse(result.window.endAtExclusive) - Date.parse(result.window.startAt)) / 3600000).toBe(169);
    expect(result.rows[0].counts.published).toBe(2);
    expect(result.rows[0].analysis.rows.find(row => row.metric === 'publishedPosts')).toMatchObject({ currentTotal: null, currentObservedValue: 2, currentCoverage: 'partial', percentChange: null });
    expect(result.rows[0].analysis.rows.find(row => row.metric === 'reach')).toMatchObject({ currentObservedValue: null, currentTotal: null, currentCoverage: 'unavailable', currentSampleSize: null });
    expect(result).not.toHaveProperty('recommendations');
  });
  it('counts actual receipt states per matched brand/platform and excludes approved drafts with no receipt', () => {
    const input = props({ revisions: [revision(1), revision(2), revision(3), revision(4), revision(5), revision(6), revision(7, undefined, 'dneskai'), revision(8, undefined, 'devshark', 'threads')],
      publications: [publication(1), publication(2, 'queued'), publication(3, 'claimed'), publication(4, 'failed'), publication(5, 'reconciliation'), publication(6, 'cancelled'), publication(8, 'published', 'threads')] });
    const original = structuredClone(input); const result = weeklyRecordedResults(input);
    expect(result.rows[0].counts).toEqual({ published: 1, waiting: 2, failed: 1, reconciliation: 1, cancelled: 1 });
    expect(result.rows[1].counts.published).toBe(1); expect(result.rows[2].counts.published).toBe(0); expect(input).toEqual(original);
    expect(weeklyRecordedResults({ ...input, brand: 'dneskai' }).rows.every(row => row.brand === 'dneskai')).toBe(true);
  });
  it('holds malformed, unmatched, duplicate and platform-mismatched publication metadata without claiming success', () => {
    const input = props({ revisions: [revision(1), revision(2), revision(3), revision(3), revision(4), revision(5)],
      publications: [publication(1), publication(1), publication(2, 'published', 'threads'), publication(3), { ...publication(4), remote_url: 'javascript:PRIVATE-URL' }, { ...publication(5), remote_media_id: null }, publication(99)] });
    const result = weeklyRecordedResults(input);
    expect(result.rows.every(row => row.counts.published === 0)).toBe(true); expect(result.excluded).toBeGreaterThan(0);
    expect(result.rows[0].counts.reconciliation).toBe(2);
    render(input); expect(container.textContent).not.toContain('PRIVATE-'); expect(container.querySelectorAll('a,button,input,img,iframe')).toHaveLength(0);
  });
  it.each(['en', 'cs'] as const)('shows unavailable engagement, clear partial scope and accessible date/status text in %s without fetching', lang => {
    const fetcher = vi.spyOn(globalThis, 'fetch'); render(props({ lang, revisions: [revision(1)], publications: [publication(1)] }));
    expect(container.textContent).toContain(lang === 'cs' ? 'dílčí vzorek' : 'partial sample');
    expect(container.textContent).toContain(lang === 'cs' ? 'nikoli ke skutečnému času zveřejnění' : 'not the actual publication timestamp');
    expect(container.textContent).toContain(lang === 'cs' ? 'Potvrzené zveřejnění' : 'Confirmed published');
    expect(container.textContent).toContain(lang === 'cs' ? 'Není změřeno' : 'Not collected');
    expect(container.textContent).not.toMatch(/\d+%|PRIVATE-/); expect(container.querySelectorAll('time')).toHaveLength(2);
    expect(container.querySelector('section')?.getAttribute('aria-labelledby')).toBe(container.querySelector('h2')?.id);
    const metrics = [...container.querySelectorAll('dl')].at(-1)!;
    expect([...metrics.querySelectorAll('dd')].map(item => item.textContent)).toEqual(Array(4).fill(lang === 'cs' ? 'Není změřeno' : 'Not collected'));
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps an empty operational sample honest and defaults to the preceding seven completed Prague days', () => {
    const input = props({ weekStartsOn: undefined, now: new Date('2026-10-31T23:30:00Z') });
    expect(weeklyRecordedResults(input).window).toMatchObject({ startDate: '2026-10-25', endDateInclusive: '2026-10-31' });
    render(input); expect(container.textContent).toContain('No matched publication records');
    expect(container.textContent).toContain('not a complete weekly total');
    expect(container.textContent).not.toContain('0%');
  });
  it('bounds input records and fails closed on invalid reporting dates', () => {
    const input = props({ revisions: Array.from({ length: 101 }, (_, index) => revision(index + 1)), publications: Array.from({ length: 101 }, (_, index) => publication(index + 1)) });
    expect(weeklyRecordedResults(input).rows[0].counts.published).toBe(100);
    render(props({ weekStartsOn: '2026-02-30' })); expect(container.querySelector('[role="alert"]')?.textContent).toBe('The reporting window is unavailable.');
    expect(container.querySelectorAll('dl')).toHaveLength(0);
  });
});
