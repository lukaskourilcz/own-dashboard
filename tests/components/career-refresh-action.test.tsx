// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { JobsPanel } from '@/components/panels/jobs-panel';
import { OwnerPreferencesProvider } from '@/lib/owner-preferences';
import { jobs } from '@/lib/i18n/sections/jobs';
import { common } from '@/lib/i18n/sections/common';
const state = vi.hoisted(() => ({ lang: 'en' as 'en' | 'cs', ok: vi.fn(), err: vi.fn() }));
vi.mock('@/lib/i18n', () => ({ useDict: () => ({ jobs: jobs[state.lang], common: common[state.lang] }), useLang: () => ({ lang: state.lang }), useDateLocale: () => undefined }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/use-prefs', () => ({ useCvLinks: () => ({ cs: '', en: '' }), useCzechCareerVisibility: () => ({ showCzechCareer: false }) }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ ok: state.ok, err: state.err }) }));
vi.mock('@/components/panels/oslo-career-workspace', () => ({ OsloCareerWorkspace: () => <p>Synthetic saved Career</p>, OsloLetterReview: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
let root: Root, host: HTMLDivElement, client: QueryClient, network: ReturnType<typeof vi.fn>, activate: ReturnType<typeof vi.fn<() => Promise<void>>>;
const summary = (ownerId = owner) => ({ ownerId, startedAt: new Date(Date.now() - 1000).toISOString(), finishedAt: new Date().toISOString(), ok: true, inserted: 1, refreshed: 2, pruned: 0, sources: { curated: { count: 3 } } });
beforeEach(() => { state.lang = 'en'; state.ok.mockReset(); state.err.mockReset(); network = vi.fn().mockResolvedValue(Response.json(summary())); vi.stubGlobal('fetch', network); activate = vi.fn().mockResolvedValue(undefined); host = document.createElement('div'); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); });
afterEach(() => { act(() => root.unmount()); host.remove(); client.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
function render(preview = false, suppliedOwner = owner) { act(() => root.render(<QueryClientProvider client={client}><OwnerPreferencesProvider ownerId={owner}><JobsPanel activated={false} onActivate={activate} isPreview={preview} listings={[]} userStates={[]} setUserStates={vi.fn()} savedPositions={[]} setSavedPositions={vi.fn()} applications={[]} setApplications={vi.fn()} events={[]} setEvents={vi.fn()} templates={[]} setTemplates={vi.fn()} lastRun={null} userId={suppliedOwner} /></OwnerPreferencesProvider></QueryClientProvider>)); }
const button = () => [...host.querySelectorAll('button')].find(el => el.textContent === jobs[state.lang].checkOffers)!;
async function click() { await act(async () => { button().click(); await new Promise(resolve => setTimeout(resolve, 20)); }); }
it.each(['foreign', 'empty', 'failed'] as const)('refuses %s refresh receipts before activation or success feedback', async kind => {
 network.mockResolvedValue(Response.json(kind === 'foreign' ? summary(other) : kind === 'empty' ? {} : { error: 'PRIVATE TEST provider text' }, { status: kind === 'failed' ? 503 : 200 }));
 render(); await click(); expect(activate).not.toHaveBeenCalled(); expect(state.ok).not.toHaveBeenCalled(); expect(host.querySelector('[role=alert]')?.textContent).toBe(jobs.en.refreshErr); expect(state.err).not.toHaveBeenCalled();
 const init = network.mock.calls[0][1] as RequestInit; expect(new Headers(init.headers).get('x-own-dashboard-owner')).toBe(owner); expect(init.signal).toBeInstanceOf(AbortSignal);
});
it('admits only one same-frame explicit refresh and carries its original owner', async () => {
 network.mockImplementation(() => new Promise(() => {})); render(); const check = button(); act(() => { check.click(); check.click(); });
 expect(network).toHaveBeenCalledOnce(); const init = network.mock.calls[0][1] as RequestInit; expect(new Headers(init.headers).get('x-own-dashboard-owner')).toBe(owner);
 act(() => root.render(null)); expect(init.signal!.aborted).toBe(true); expect(activate).not.toHaveBeenCalled();
});

for (const lang of ['en', 'cs'] as const) {
 it(`${lang}: reports confirmed success once after loading, without duplicate error copy`, async () => {
  state.lang = lang; render(); await click(); expect(activate).toHaveBeenCalledOnce(); expect(state.ok).toHaveBeenCalledExactlyOnceWith(jobs[lang].refreshOk); expect(host.querySelector('[role=alert]')).toBeNull(); expect(network).toHaveBeenCalledOnce();
 });
 it(`${lang}: distinguishes rate refusal and lets the owner explicitly retry`, async () => {
  state.lang = lang; network.mockResolvedValueOnce(Response.json({ error: 'PRIVATE TEST' }, { status: 429 })).mockResolvedValueOnce(Response.json(summary())); render(); await click();
  expect(host.querySelector('[role=alert]')?.textContent).toBe(jobs[lang].refreshRateLimited); expect(activate).not.toHaveBeenCalled(); expect(state.ok).not.toHaveBeenCalled(); await click(); expect(activate).toHaveBeenCalledOnce(); expect(network).toHaveBeenCalledTimes(2);
 });
 it(`${lang}: reloads an accepted refresh locally without sending the feed request twice`, async () => {
  state.lang = lang; activate.mockRejectedValueOnce(Error('PRIVATE TEST')).mockResolvedValueOnce(undefined); render(); await click(); expect(host.querySelector('[role=alert]')?.textContent).toBe(jobs[lang].refreshLoadErr); expect(state.ok).not.toHaveBeenCalled();
  await act(async () => { [...host.querySelectorAll('button')].find(el => el.textContent === (lang === 'cs' ? 'Načíst znovu' : 'Retry loading'))!.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(activate).toHaveBeenCalledTimes(2); expect(network).toHaveBeenCalledOnce(); expect(host.querySelector('[role=alert]')).toBeNull();
 });
}
it('keeps the preview local and refuses a mismatched live owner before transport', async () => {
 render(false, other); await click(); expect(network).not.toHaveBeenCalled(); expect(activate).not.toHaveBeenCalled();
 act(() => root.render(null)); render(true); await click(); expect(network).not.toHaveBeenCalled(); expect(activate).toHaveBeenCalledOnce(); expect(state.ok).not.toHaveBeenCalled();
});
it('ignores a late successful refresh after unmount rather than activating another destination', async () => {
 let finish!: (value: Response) => void; network.mockImplementation(() => new Promise(resolve => { finish = resolve; })); render(); act(() => button().click()); act(() => root.render(null));
 await act(async () => { finish(Response.json(summary())); await new Promise(resolve => setTimeout(resolve, 20)); });
 expect(activate).not.toHaveBeenCalled(); expect(state.ok).not.toHaveBeenCalled(); expect(state.err).not.toHaveBeenCalled();
});

it('bounds a stalled post-confirmation reload without repeating the feed request or accepting its late result', async () => {
 vi.useFakeTimers(); vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => { const controller = new AbortController(); setTimeout(() => controller.abort(), ms); return controller.signal; });
 let finish!: () => void; activate.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; })); render(); act(() => button().click());
 await act(async () => { await vi.advanceTimersByTimeAsync(0); }); expect(activate).toHaveBeenCalledOnce();
 await act(async () => { await vi.advanceTimersByTimeAsync(15_001); }); expect(host.querySelector('[role=alert]')?.textContent).toBe(jobs.en.refreshLoadErr); expect(state.ok).not.toHaveBeenCalled();
 await act(async () => { finish(); await vi.advanceTimersByTimeAsync(0); }); expect(state.ok).not.toHaveBeenCalled(); expect(network).toHaveBeenCalledOnce();
});
