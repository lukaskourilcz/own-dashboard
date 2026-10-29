// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WeeklyPlanningFlow } from '@/components/work/weekly-planning';
import { professional } from '@/lib/i18n/sections/professional';
import { common } from '@/lib/i18n/sections/common';
import { mondayKey, previousMondayKey } from '@/lib/date-keys';
import { qk } from '@/lib/queries/keys';
import type { WeeklyFocusSet } from '@/lib/weekly-focus';
import type { WeeklyReview } from '@/lib/types';
const state = vi.hoisted(() => ({ lang: 'en' as 'en' | 'cs', load: vi.fn(), client: {} }));
vi.mock('@/lib/i18n', () => ({ useDict: () => ({ professional: professional[state.lang], common: common[state.lang] }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => state.client }));
vi.mock('@/lib/weekly-focus', () => ({ loadWeeklyFocusSnapshot: (...args: unknown[]) => state.load(...args) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const owner = '11111111-1111-4111-8111-111111111111';
let root: Root, container: HTMLDivElement, client: QueryClient;
const buttons = (text: string) => [...container.querySelectorAll('button')].filter(button => button.textContent === text);
const settled = async () => act(async () => { for (let i = 0; i < 5; i++) await new Promise(done => setTimeout(done, 0)); });
function render(step: 'done' | 'carry' | 'summary' = 'done', preview = false) {
  const review = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: owner, week_start: mondayKey(), status: 'draft', summary: 'Keep my plan', items: { step }, completed_at: null, created_at: '2026-10-24T10:00:00Z', updated_at: '2026-10-24T10:00:00Z' } as WeeklyReview;
  act(() => root.render(<QueryClientProvider client={client}><WeeklyPlanningFlow ownerId={owner} reviews={[review]} setReviews={() => {}} projects={[]} organizations={[]} todos={[]}
    lastWeekCalendar={{ ok: true, events: [] }} isPreview={preview} /></QueryClientProvider>));
}
const sets = (): WeeklyFocusSet[] => [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', user_id: owner, focus_date: previousMondayKey(), generation: 2, items: [
  { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', user_id: owner, set_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', todo_id: null, position: 1,
    title_snapshot: 'Finished fixture task', project_name_snapshot: 'Fixture project', completed_at: '2026-10-24T09:00:00Z' },
] }];
beforeEach(() => { state.lang = 'en'; state.load.mockReset(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); });
afterEach(() => { act(() => root.unmount()); container.remove(); client.clear(); });
for (const lang of ['en','cs'] as const) describe(`${lang} weekly focus recovery`, () => {
  it.each(['done','carry'] as const)('does not invent an empty %s result after failure and recovers explicitly', async step => {
    state.lang = lang; const t = professional[lang]; state.load.mockRejectedValue(Error('Private fixture transport failure')); render(step); await settled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(t.focusRecapLoadFailed);
    expect(container.textContent).not.toContain(step === 'done' ? t.focusRecapEmpty : t.carryForwardEmpty);
    expect(container.textContent).not.toContain('0/0'); expect(container.textContent).not.toContain('Private fixture');
    expect(buttons(t.planningNext)[0]!.disabled).toBe(true); expect(buttons(t.completeWeek)[0]!.disabled).toBe(true);
    expect(buttons(t.saveDraft)[0]!.disabled).toBe(false); expect(state.load).toHaveBeenCalledTimes(1);
    state.load.mockResolvedValue([]); await act(async () => buttons(t.planningRetry)[0]!.click()); await settled();
    expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.textContent).toContain(step === 'done' ? t.focusRecapEmpty : t.carryForwardEmpty);
    expect(buttons(t.planningNext)[0]!.disabled).toBe(false); expect(buttons(t.completeWeek)[0]!.disabled).toBe(false); expect(state.load).toHaveBeenCalledTimes(2);
  });
  it('retains cached results with a failed-refresh warning and refuses completion until retry', async () => {
    state.lang = lang; const t = professional[lang]; state.load.mockResolvedValue(sets()); render(); await settled();
    expect(container.textContent).toContain('Finished fixture task'); expect(container.textContent).toContain('1/1');
    state.load.mockRejectedValue(Error('Private fixture failure'));
    await act(async () => { await client.invalidateQueries({ queryKey: [...qk.weeklyFocusRecap, owner, previousMondayKey()], exact: true }); }); await settled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(t.focusRecapStale);
    expect(container.textContent).toContain('Finished fixture task'); expect(container.textContent).toContain('1/1'); expect(buttons(t.completeWeek)[0]!.disabled).toBe(true);
    state.load.mockResolvedValue(sets()); await act(async () => buttons(t.planningRetry)[0]!.click()); await settled();
    expect(container.querySelector('[role="alert"]')).toBeNull(); expect(buttons(t.completeWeek)[0]!.disabled).toBe(false);
  });
  it('explains the unavailable completion on summary and preserves typed draft through retry', async () => {
    state.lang = lang; const t = professional[lang]; state.load.mockRejectedValue(Error('Fixture unavailable')); render('summary'); await settled();
    const field = container.querySelector('textarea')!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'Retain my changed draft'); field.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(t.focusRecapLoadFailed); expect(buttons(t.completeWeek)[0]!.disabled).toBe(true);
    state.load.mockResolvedValue([]); await act(async () => buttons(t.planningRetry)[0]!.click()); await settled();
    expect(field.value).toBe('Retain my changed draft'); expect(buttons(t.completeWeek)[0]!.disabled).toBe(false);
  });
  it('keeps pending and public-preview history distinct from an empty saved recap', async () => {
    state.lang = lang; const t = professional[lang]; let resolve!: (value: WeeklyFocusSet[]) => void;
    state.load.mockImplementation(() => new Promise<WeeklyFocusSet[]>(done => { resolve = done; })); render(); await settled();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(t.focusRecapLoading); expect(container.textContent).not.toContain('0/0');
    await act(async () => resolve([])); await settled(); expect(container.textContent).toContain('0/0');
    act(() => root.unmount()); client.clear(); root = createRoot(container); state.load.mockClear(); render('done', true); await settled();
    expect(container.textContent).toContain(t.focusRecapUnavailable); expect(container.textContent).not.toContain('0/0'); expect(state.load).not.toHaveBeenCalled();
  });
});
