// @vitest-environment happy-dom
import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/lib/marketing-calendars', async original => ({ ...await original<object>(), loadMarketingCalendars: m.read }));
import { useMarketingCalendars } from '@/components/marketing/use-marketing-calendars';
import { MARKETING_CALENDAR_SOURCES, type MarketingCalendarsResponse } from '@/lib/marketing-calendars';
import { qk } from '@/lib/queries/keys';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const data = (name = 'First confirmed plan'): MarketingCalendarsResponse => ({ checkedAt: '2026-10-28T09:00:00.000Z', sources: MARKETING_CALENDAR_SOURCES.map(source => ({ ...source, status: 'ok', detail: null, calendar: { name, launch: null, periodStart: null, periodEnd: null, entries: [{ id: 'entry', date: '2026-10-28', time: '12:30', platform: 'instagram', kind: 'carousel', title: name, status: 'planned', tipRefs: [] }], prelaunch: [], skipped: 0 } })) });
let host: HTMLDivElement, root: Root, client: QueryClient, current: ReturnType<typeof useMarketingCalendars>;
function Harness({ preview }: { preview?: MarketingCalendarsResponse }) { const value = useMarketingCalendars(preview); useLayoutEffect(() => { current = value; }); return null; }
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise(done => setTimeout(done, 10)); });
async function mount(preview?: MarketingCalendarsResponse) { await act(async () => root.render(<QueryClientProvider client={client}><Harness preview={preview}/></QueryClientProvider>)); await settle(); }
beforeEach(() => { m.read.mockReset().mockResolvedValue({ kind: 'ok', data: data() }); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(() => { act(() => root.unmount()); host.remove(); client.clear(); vi.restoreAllMocks(); });
for (const kind of ['error', 'rate-limited'] as const) it(`retains confirmed source data after ${kind} and replaces it only on successful explicit recovery`, async () => {
  await mount(); expect(current.view.kind).toBe('ok'); const confirmed = client.getQueryData(qk.marketingCalendars);
  m.read.mockResolvedValueOnce({ kind }); act(() => current.checkAgain()); await settle();
  expect(current.view.kind).toBe('ok'); expect(current.refreshError).toBe(kind); expect(client.getQueryData(qk.marketingCalendars)).toBe(confirmed); expect(m.read).toHaveBeenCalledTimes(2);
  m.read.mockResolvedValueOnce({ kind: 'ok', data: data('New confirmed plan') }); act(() => current.checkAgain()); await settle();
  expect(current.view).toEqual({ kind: 'ok', data: data('New confirmed plan') }); expect(current.refreshError).toBeNull(); expect(m.read).toHaveBeenCalledTimes(3);
});
for (const kind of ['error', 'rate-limited'] as const) it(`keeps an initial ${kind} distinct from a confirmed empty calendar`, async () => {
  m.read.mockResolvedValue({ kind }); await mount(); expect(current.view.kind).toBe(kind); expect(m.read).toHaveBeenCalledOnce();
});
it('replaces confirmed private source data when the server reports signed out', async () => {
  await mount(); m.read.mockResolvedValueOnce({ kind: 'signed-out' }); act(() => current.checkAgain()); await settle();
  expect(current.view.kind).toBe('signed-out'); expect(client.getQueryData(qk.marketingCalendars)).toEqual({ kind: 'signed-out' });
});
it('keeps preview recovery from starting a live calendar read', async () => {
  const preview = data('Preview plan'); await mount(preview); expect(current.canCheck).toBe(false); act(() => current.checkAgain()); await settle(); expect(m.read).not.toHaveBeenCalled(); expect(current.view).toEqual({ kind: 'ok', data: preview });
});
it('retains the whole last snapshot when a previously readable source reports a transient read error', async () => {
  await mount(); const confirmed = client.getQueryData(qk.marketingCalendars), failed = data('Other newly read content'); failed.checkedAt = '2026-10-28T10:00:00.000Z'; failed.sources[0]!.status = 'error'; failed.sources[0]!.calendar = null;
  m.read.mockResolvedValueOnce({ kind: 'ok', data: failed }); act(() => current.checkAgain()); await settle();
  expect(client.getQueryData(qk.marketingCalendars)).toBe(confirmed); expect(current.view).toEqual({ kind: 'ok', data: data() });
});

for (const status of ['not-found', 'disconnected', 'unreadable', 'wrong-project'] as const) it(`adopts an explicit ${status} source outcome instead of retaining old access`, async () => {
  await mount(); const next = data(); next.sources[0]!.status = status; next.sources[0]!.calendar = null; m.read.mockResolvedValueOnce({ kind: 'ok', data: next }); act(() => current.checkAgain()); await settle();
  expect(current.view).toEqual({ kind: 'ok', data: next }); expect(current.refreshError).toBeNull();
});
it('adopts a confirmed empty source instead of restoring its older content', async () => {
  await mount(); const next = data('Confirmed empty plan'); next.sources.forEach(source => { source.calendar!.entries = []; }); m.read.mockResolvedValueOnce({ kind: 'ok', data: next }); act(() => current.checkAgain()); await settle(); expect(current.view).toEqual({ kind: 'ok', data: next }); expect(current.refreshError).toBeNull();
});

it('keeps initial source failures explicit instead of borrowing a missing previous snapshot', async () => {
  const next = data(); next.sources[0]!.status = 'error'; next.sources[0]!.calendar = null; m.read.mockResolvedValueOnce({ kind: 'ok', data: next }); await mount(); expect(current.view).toEqual({ kind: 'ok', data: next }); expect(current.refreshError).toBeNull();
});
it('keeps a prior source snapshot with rate guidance for a recorded 429', async () => {
  await mount(); const next = data(); next.sources[0]!.status = 'error'; next.sources[0]!.detail = '429'; next.sources[0]!.calendar = null; m.read.mockResolvedValueOnce({ kind: 'ok', data: next }); act(() => current.checkAgain()); await settle(); expect(current.view).toEqual({ kind: 'ok', data: data() }); expect(current.refreshError).toBe('rate-limited');
});
