// @vitest-environment happy-dom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MarketingPanel } from '@/components/panels/marketing-panel';
import { NavigationGuardProvider } from '@/components/navigation-guard';
import { OwnerPreferencesProvider } from '@/lib/owner-preferences';
import { qk } from '@/lib/queries/keys';
import { marketingStateFixture, stateOwner } from '../lib/marketing-state-fixture';
const m = vi.hoisted(() => ({ lang: 'en' as 'en' | 'cs' }));
vi.mock('@/lib/i18n/lang', async original => {
 const actual = await original<typeof import('@/lib/i18n/lang')>();
 return { ...actual, useLang: () => ({ lang: m.lang }) };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
 m.lang = 'en'; host = document.createElement('div'); document.body.append(host); root = createRoot(host);
 client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => { act(() => root.unmount()); host.remove(); client.clear(); vi.unstubAllGlobals(); });
const render = (owner: string | null = stateOwner) => act(() => root.render(<StrictMode><QueryClientProvider client={client}><NavigationGuardProvider>{owner ? <OwnerPreferencesProvider ownerId={owner}><MarketingPanel onOpenKnowledge={vi.fn()}/></OwnerPreferencesProvider> : <MarketingPanel onOpenKnowledge={vi.fn()}/>}</NavigationGuardProvider></QueryClientProvider></StrictMode>));
const displayed = (text: string) => vi.waitFor(async () => { await act(async () => {}); expect(host.textContent).toContain(text); });
for (const lang of ['en', 'cs'] as const) {
 it(`${lang}: admits one captured read and reuses its validated cache through local view changes`, async () => {
  m.lang = lang; const fetcher = vi.fn(async () => Response.json(marketingStateFixture())); vi.stubGlobal('fetch', fetcher);
  render(); await displayed('Reviewed draft'); expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]).toEqual(['/api/marketing/state', expect.objectContaining({ headers: { 'x-own-dashboard-owner': stateOwner } })]);
  act(() => host.querySelector<HTMLButtonElement>('#marketing-tab-calendar')!.click()); await displayed('Reviewed plan'); expect(fetcher).toHaveBeenCalledOnce();
  act(() => host.querySelector<HTMLButtonElement>('#marketing-tab-review')!.click()); await displayed('Reviewed draft'); expect(fetcher).toHaveBeenCalledOnce();
  expect(client.getQueryData(qk.marketingState)).toBeDefined();
 });
 it(`${lang}: refuses a foreign-owner reply without caching or rendering its private revision`, async () => {
  m.lang = lang; const value = marketingStateFixture(); value.ownerId = '99999999-9999-4999-8999-999999999999';
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(value))); render();
  await displayed(lang === 'cs' ? 'Marketing není dostupný.' : 'Marketing is unavailable.');
  expect(host.textContent).not.toContain('Reviewed draft'); expect(client.getQueryData(qk.marketingState)).toBeUndefined();
 });
}
it('does not read or show private records without the original owner scope', async () => {
 const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); render(null); await displayed('Marketing is unavailable.');
 expect(fetcher).not.toHaveBeenCalled(); expect(host.textContent).not.toContain('No posts waiting');
});
it('retires an admitted read on unmount and never caches the later result', async () => {
 let finish!: (value: Response) => void;
 const fetcher = vi.fn<typeof fetch>(() => new Promise(resolve => { finish = resolve; })); vi.stubGlobal('fetch', fetcher); render();
 await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
 const original = fetcher.mock.calls[0][1]!.signal!; act(() => root.render(null)); expect(original.aborted).toBe(true);
 await act(async () => { finish(Response.json(marketingStateFixture())); });
 expect(client.getQueryData(qk.marketingState)).toBeUndefined();
});
