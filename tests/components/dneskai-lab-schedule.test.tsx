// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DneskaiLabTab } from '@/components/marketing/dneskai/lab/lab-tab';
import { createDneskaiWorkspaceFixture } from '@/lib/demo/dneskai-workspace-fixtures';
import { dneskaiLabDeadline, dneskaiLabDay, dneskaiNextFreeSlot, dneskaiTakenSlots } from '@/lib/marketing/dneskai-lab';
import { dneskaiWorkspaceKeys } from '@/lib/marketing/dneskai-workspace-client';
import { dneskaiLab } from '@/lib/i18n/sections/dneskai-lab';
const m = vi.hoisted(() => ({ api: vi.fn(), loadReview: vi.fn(), approve: vi.fn(), loadMedia: vi.fn(async () => ({ candidates: [] })), fit: vi.fn(async () => ({})) }));
vi.mock('@/lib/marketing/dneskai-workspace-client', async importOriginal => ({ ...await importOriginal<object>(), dneskaiWorkspaceApi: m.api }));
vi.mock('@/lib/i18n', () => ({ useLang: () => ({ lang: 'en' }) }));
vi.mock('next/image', () => ({ default: (props: Record<string, unknown>) => {
  const rest = Object.fromEntries(Object.entries(props).filter(([key]) => !['unoptimized', 'priority'].includes(key)));
  // eslint-disable-next-line @next/next/no-img-element -- deterministic image load events
  return <img {...rest} alt={String(props.alt ?? '')} />;
} }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, client: QueryClient;
const read = createDneskaiWorkspaceFixture(new Date('2026-10-28T09:00:00Z'));
const post = read.posts[0]!, at = Date.parse(post.scheduledAt);
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(at - 120_000); vi.clearAllMocks(); m.loadReview.mockReset().mockRejectedValue(new Error('TEST_ONLY_CALENDAR_UNAVAILABLE')); m.fit.mockRejectedValue(new Error('TEST_ONLY_FIT_OFFLINE')); m.api.mockResolvedValue(m); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('TEST_ONLY_NETWORK_DISABLED')));
  window.history.replaceState(null, '', `/?labPost=${post.id}`);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); client.clear(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount(lang: 'en' | 'cs' = 'en') {
  const current = { ...structuredClone(read), generatedAt: new Date().toISOString(), accounts: read.accounts.map(account => ({ ...account, enabled: true })) };
  await act(async () => { root.render(<QueryClientProvider client={client}><TooltipProvider><DneskaiLabTab read={current} projectId="dneskai" lang={lang} preview={false} refreshing={false} onRefresh={() => {}} renderFailed={new Set()} addRenderFailed={() => {}} /></TooltipProvider></QueryClientProvider>); });
  await act(async () => { host.querySelectorAll('img').forEach(image => image.dispatchEvent(new Event('load'))); });
  const button = host.querySelector<HTMLButtonElement>('[data-testid="dneskai-lab-approve"]')!; expect(button.disabled).toBe(false); return button;
}
it('treats the exact saved instant as passed, retaining a genuinely future instant', () => {
  expect(dneskaiLabDeadline(post.scheduledAt, at - 1).passed).toBe(false);
  expect(dneskaiLabDeadline(post.scheduledAt, at)).toMatchObject({ passed: true, urgent: false });
  expect(dneskaiLabDay(read, post.scheduledAt.slice(0, 10), at).approvable.some(row => row.id === post.id)).toBe(false);
});
for (const lang of ['en', 'cs'] as const) it(`withholds elapsed scheduled approval while retaining rescheduling actions (${lang})`, async () => {
  const approve = await mount(lang); await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(approve.disabled).toBe(true);
  const description = approve.getAttribute('aria-describedby'); expect(description).toBeTruthy(); expect(document.getElementById(description!)?.textContent).toBe(dneskaiLab[lang].actions.scheduleExpired);
  const publish = host.querySelector<HTMLButtonElement>('[data-testid="dneskai-lab-publish-now"]')!; expect(publish.disabled).toBe(false);
  expect(host.textContent).toContain(dneskaiLab[lang].actions.publishNow);
  expect(m.approve).not.toHaveBeenCalled();
});
it('rechecks the actual time before approving between shared-clock renders', async () => {
  const approve = await mount(); vi.setSystemTime(at);
  await act(async () => { approve.click(); });
  expect(m.approve).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
});

it('rechecks time after asynchronous API setup before admitting approval', async () => {
  const approve = await mount(); let resolve!: (api: typeof m) => void; m.api.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  await act(async () => { approve.click(); }); vi.setSystemTime(at);
  await act(async () => { resolve(m); }); expect(m.approve).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
});

const originalNow = new Date('2026-10-28T09:00:00Z');
const completeCalendar = () => {
  const calendar = { ...structuredClone(read), calendarComplete: true, unreadable: 0, waiting: [] };
  calendar.posts.push({ ...structuredClone(post), id: 'd0e5ca10-0000-4000-8000-000000000012', scheduledAt: '2026-10-28T11:30:00.000Z' });
  return calendar;
};
async function mountMissed(lang: 'en' | 'cs' = 'en') {
  vi.setSystemTime(originalNow); const current = { ...structuredClone(read), waiting: [] }, missed = current.posts.find(row => row.id.endsWith('000011'))!;
  window.history.replaceState(null, '', `/?labPost=${missed.id}`);
  await act(async () => { root.render(<QueryClientProvider client={client}><TooltipProvider><DneskaiLabTab read={current} projectId="dneskai" lang={lang} preview={false} refreshing={false} onRefresh={() => {}} renderFailed={new Set()} addRenderFailed={() => {}} /></TooltipProvider></QueryClientProvider>); });
  await act(async () => { host.querySelectorAll('img').forEach(image => image.dispatchEvent(new Event('load'))); await vi.advanceTimersByTimeAsync(1); });
  return missed;
}
it('does not load a complete calendar for a future post', async () => { await mount(); expect(m.loadReview).not.toHaveBeenCalled(); });
for (const lang of ['en', 'cs'] as const) it(`uses complete occupancy outside the paged review list for a move (${lang})`, async () => {
  const calendar = completeCalendar(); m.loadReview.mockResolvedValue(calendar); const missed = await mountMissed(lang);
  expect(m.loadReview).toHaveBeenCalledOnce(); expect(m.loadReview.mock.calls[0]).toEqual(['dneskai', expect.any(AbortSignal), undefined, 'calendar']);
  const target = dneskaiNextFreeSlot({ today: calendar.today, slots: calendar.slots, taken: dneskaiTakenSlots(calendar, missed.id), now: +originalNow });
  expect(target).toBe('2026-10-28T16:00:00.000Z');
  expect(host.querySelector('[data-testid="dneskai-lab-move"]')?.textContent).toContain('17:00');
  await act(async () => { await vi.advanceTimersByTimeAsync(31_000); }); expect(m.loadReview).toHaveBeenCalledOnce();
});
for (const state of ['loading', 'failure', 'legacy', 'unreadable', 'wrong-day'] as const) it(`withholds a free-slot claim for ${state} occupancy`, async () => {
  const calendar = completeCalendar();
  if (state === 'loading') m.loadReview.mockReturnValue(new Promise(() => {}));
  else if (state === 'legacy') m.loadReview.mockResolvedValue({ ...calendar, calendarComplete: undefined });
  else if (state === 'unreadable') m.loadReview.mockResolvedValue({ ...calendar, unreadable: 1 });
  else if (state === 'wrong-day') m.loadReview.mockResolvedValue({ ...calendar, today: '2026-10-27' });
  await mountMissed(); expect(host.querySelector('[data-testid="dneskai-lab-move"]')).toBeNull();
  expect(host.querySelector('[data-testid="dneskai-lab-moved"]')?.textContent).not.toContain(dneskaiLab.en.actions.moved.none);
});
for (const lang of ['en', 'cs'] as const) it(`retries unavailable occupancy explicitly and restores focus to the move action (${lang})`, async () => {
  await mountMissed(lang); const retry = [...host.querySelectorAll('button')].find(button => button.textContent === dneskaiLab[lang].actions.moved.retry)!;
  expect(retry).toBeDefined(); retry.focus(); m.loadReview.mockResolvedValue(completeCalendar());
  await act(async () => { retry.click(); await vi.advanceTimersByTimeAsync(1); });
  expect(m.loadReview).toHaveBeenCalledTimes(2); const move = host.querySelector<HTMLButtonElement>('[data-testid="dneskai-lab-move"]'); expect(move?.textContent).toContain('17:00'); expect(document.activeElement).toBe(move);
});
it('does not use a complete cached snapshot after its refresh fails', async () => {
  m.loadReview.mockResolvedValueOnce(completeCalendar()); await mountMissed(); expect(host.querySelector('[data-testid="dneskai-lab-move"]')).not.toBeNull();
  const query = client.getQueryCache().findAll().find(query => query.queryKey.at(-1) === 'calendar')!;
  await act(async () => { await client.refetchQueries({ queryKey: query.queryKey, exact: true }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(host.querySelector('[data-testid="dneskai-lab-move"]')).toBeNull(); expect(host.textContent).toContain(dneskaiLab.en.actions.moved.unavailable);
});

it('reuses a fresh complete Calendar read without another request', async () => {
  vi.setSystemTime(originalNow); client.setQueryData(dneskaiWorkspaceKeys('dneskai').calendar, completeCalendar()); await mountMissed();
  expect(m.loadReview).not.toHaveBeenCalled(); expect(host.querySelector('[data-testid="dneskai-lab-move"]')?.textContent).toContain('17:00');
});
it('reports no free slot only after positive complete readable occupancy', async () => {
  m.loadReview.mockResolvedValue({ ...completeCalendar(), waiting: read.waiting }); await mountMissed();
  expect(host.querySelector('[data-testid="dneskai-lab-moved"]')?.textContent).toContain(dneskaiLab.en.actions.moved.none);
  expect(host.querySelector('[data-testid="dneskai-lab-move"]')).toBeNull(); expect([...host.querySelectorAll('button')].some(button => button.textContent === dneskaiLab.en.actions.moved.retry)).toBe(false);
});
