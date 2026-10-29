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
import { marketingWorkspace } from '@/lib/i18n/sections/marketing-workspace';
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
const render = (owner: string | null = stateOwner, preview = false) => act(() => root.render(<StrictMode><QueryClientProvider client={client}><NavigationGuardProvider>{owner ? <OwnerPreferencesProvider ownerId={owner}><MarketingPanel isPreview={preview} onOpenKnowledge={vi.fn()}/></OwnerPreferencesProvider> : <MarketingPanel onOpenKnowledge={vi.fn()}/>}</NavigationGuardProvider></QueryClientProvider></StrictMode>));
const displayed = (text: string) => vi.waitFor(async () => { await act(async () => {}); expect(host.textContent).toContain(text); });
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === text)!;
for (const lang of ['en', 'cs'] as const) {
 it(`${lang}: uses the page Refresh as the single job-status read action`, async () => {
  m.lang = lang; const t = marketingWorkspace[lang], fetcher = vi.fn(async () => Response.json(marketingStateFixture())); vi.stubGlobal('fetch', fetcher);
  render(); await displayed('Reviewed draft');
  expect(button(lang === 'cs' ? 'Zkontrolovat stav znovu' : 'Check status again')).toBeUndefined();
  await act(async () => { button(t.refresh).click(); await client.getQueryCache().find({ queryKey: qk.marketingState })!.promise; });
  expect(fetcher).toHaveBeenCalledTimes(2);
 });
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
  await displayed(marketingWorkspace[lang].unavailable);
  expect(host.textContent).not.toContain('Reviewed draft'); expect(client.getQueryData(qk.marketingState)).toBeUndefined();
 });
}
for (const lang of ['en', 'cs'] as const) {
 it.each(['queued', 'claimed', 'cancelled'] as const)(`${lang}: shows the actual %s publication state in its loaded receipt`, async status => {
  m.lang = lang; const t = marketingWorkspace[lang], value = marketingStateFixture(); value.publications[0].status = status;
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(value))); render(); await displayed('Reviewed draft');
  act(() => host.querySelector<HTMLButtonElement>('#marketing-tab-results')!.click());
  const receipts = host.querySelector(`section[aria-label="${t.loadedReceipts}"]`)!;
  expect(receipts.textContent).toContain(status === 'queued' ? t.queued : status === 'claimed' ? t.publishing : t.cancelled);
  expect(receipts.textContent).not.toContain(t.planned);
 });
 it(`${lang}: retains a checked snapshot and editor read-only through failed refresh until explicit recovery`, async () => {
  m.lang = lang; const t = marketingWorkspace[lang]; const valid = marketingStateFixture(), refused = marketingStateFixture(); refused.ownerId = '99999999-9999-4999-8999-999999999999'; refused.revisions[0].revision.title = 'UNCONFIRMED_DRAFT';
  let finish!: (value: Response) => void;
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(valid)).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(Response.json(valid)); vi.stubGlobal('fetch', fetcher);
  render(); await displayed('Reviewed draft'); const checkedAt = client.getQueryState(qk.marketingState)!.dataUpdatedAt;
  act(() => button(t.edit).click()); expect(host.querySelector('textarea')?.value).toBe('Authored draft');
  await act(async () => { button(t.refresh).click(); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2)); });
  const pendingRead = client.getQueryCache().find({ queryKey: qk.marketingState })!.promise;
  try { expect(button(t.save).disabled).toBe(true); }
  finally { await act(async () => { finish(Response.json(refused)); await pendingRead?.catch(() => undefined); }); }
  await displayed(lang === 'cs' ? 'Obnovení selhalo.' : 'Refresh failed.');
  expect(host.textContent).toContain('Reviewed draft'); expect(host.textContent).not.toContain('UNCONFIRMED_DRAFT');
  expect(host.querySelector('[role="alert"] time')?.getAttribute('datetime')).toBe(new Date(checkedAt).toISOString());
  expect(button(t.save).disabled).toBe(true); expect(host.querySelector('textarea')?.value).toBe('Authored draft');
  expect(client.getQueryState(qk.marketingState)!.dataUpdatedAt).toBe(checkedAt);
  await act(async () => { button(t.refresh).click(); await client.getQueryCache().find({ queryKey: qk.marketingState })!.promise; });
  await vi.waitFor(async () => { await act(async () => {}); expect(host.querySelector('[role="alert"]')).toBeNull(); expect(button(t.save).disabled).toBe(false); });
  expect(fetcher).toHaveBeenCalledTimes(3); expect(host.querySelector('textarea')?.value).toBe('Authored draft');
 });
 it(`${lang}: scopes empty messages to loaded records and has one publication empty explanation`, async () => {
  m.lang = lang; const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); render(stateOwner, true);
  expect(host.textContent).toContain(lang === 'cs' ? 'V načtených záznamech nejsou příspěvky ke schválení' : 'No posts to approve in the loaded records');
  expect(host.textContent).toContain(lang === 'cs' ? 'V načteném vzorku nejsou pro tuto značku žádné úlohy.' : 'No jobs for this brand in the loaded sample.');
  act(() => host.querySelector<HTMLButtonElement>('#marketing-tab-calendar')!.click());
  expect(host.textContent).toContain(lang === 'cs' ? 'V načtených záznamech nejsou žádné plány.' : 'No plans in the loaded records.');
  act(() => host.querySelector<HTMLButtonElement>('#marketing-tab-results')!.click());
  expect(host.textContent).toContain(lang === 'cs' ? 'Pro tyto plánované termíny nejsou přiřazené záznamy zveřejnění.' : 'No matched publication records for these scheduled slots.');
  expect(host.textContent).not.toContain(lang === 'cs' ? 'Zatím nejsou potvrzená zveřejnění.' : 'No publication receipts yet.'); expect(fetcher).not.toHaveBeenCalled();
 });
}
it('does not read or show private records without the original owner scope', async () => {
 const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); render(null); await displayed(marketingWorkspace.en.unavailable);
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

for (const lang of ['en', 'cs'] as const) {
 it(`${lang}: a ready text-only Thread has no empty media column or missing-artwork claim`, async () => {
  m.lang = lang; const value = marketingStateFixture(); value.revisions[0].ready = true;
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(value))); render(); await displayed('Reviewed draft');
  const article = host.querySelector('article')!;
  expect(article.textContent).not.toContain(marketingWorkspace[lang].notReady);
  expect(article.querySelector('[aria-label="Reviewed draft"]')).toBeNull();
  expect(article.className).toContain('max-w-3xl'); expect(article.className).toContain('mx-auto');
  expect(article.querySelector('[data-testid="marketing-review-body"]')!.className).not.toContain('lg:grid-cols');
 });
 it(`${lang}: missing Instagram artwork keeps its warning without an empty image column`, async () => {
  m.lang = lang; const value = marketingStateFixture(); value.revisions[0].revision.account.platform = 'instagram'; value.revisions[0].revision.format = 'post';
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(value))); render(); await displayed('Reviewed draft');
  const article = host.querySelector('article')!;
  expect(article.textContent).toContain(marketingWorkspace[lang].notReady);
  expect(article.querySelector('[aria-label="Reviewed draft"]')).toBeNull();
  expect(article.querySelector('[data-testid="marketing-review-body"]')!.className).not.toContain('lg:grid-cols');
 });
}
