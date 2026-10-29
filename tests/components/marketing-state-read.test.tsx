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
import { calendarReleaseCopy } from '@/lib/marketing/calendar-release-copy';
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

const preparedMediaState = (mimeType: 'image/jpeg' | 'video/mp4') => {
 const value = marketingStateFixture(), row = value.revisions[0]; row.ready = true; value.campaigns[0].status = 'active'; value.accounts[0].verified_at = '2026-10-29T00:00:00Z';
 row.revision.format = mimeType === 'video/mp4' ? 'reel' : 'post';
 row.revision.assets = [{ url: `https://example.test/asset.${mimeType === 'video/mp4' ? 'mp4' : 'jpg'}`, mimeType, sha256: 'c'.repeat(64), width: 1080, height: 1350, alt: 'Authored media description' }]; return value;
};
it('renders MP4 as an explicitly controlled video and waits for decoded media before approval', async () => {
 const value = preparedMediaState('video/mp4'); vi.stubGlobal('fetch', vi.fn(async () => Response.json(value))); render(); await displayed('Reviewed draft');
 const video = host.querySelector('video')!; expect(video).not.toBeNull(); expect(host.querySelector('img')).toBeNull();
 expect(video.controls).toBe(true); expect(video.autoplay).toBe(false); expect(video.preload).toBe('metadata'); expect(video.getAttribute('aria-label')).toBe('Authored media description');
 expect(button(marketingWorkspace.en.approve).disabled).toBe(true);
 act(() => video.dispatchEvent(new Event('loadeddata'))); expect(button(marketingWorkspace.en.approve).disabled).toBe(true);
 Object.defineProperty(video, 'readyState', { value: 2 }); act(() => video.dispatchEvent(new Event('loadeddata'))); expect(button(marketingWorkspace.en.approve).disabled).toBe(false);
 act(() => video.dispatchEvent(new Event('error'))); expect(button(marketingWorkspace.en.approve).disabled).toBe(true);
});
it('does not reuse a loaded hash for another row or changed asset URL', async () => {
 const value = preparedMediaState('video/mp4'), second = structuredClone(value.revisions[0]); second.id = '00000031-0000-4000-8000-000000000000'; second.revision.title = 'Different revision'; second.revision.assets[0].url = 'https://example.test/other.mp4'; value.revisions.push(second);
 const next = structuredClone(value); next.revisions[0].revision.assets[0].url = 'https://example.test/refreshed.mp4';
 const fetcher = vi.fn().mockResolvedValueOnce(Response.json(value)).mockResolvedValueOnce(Response.json(next)); vi.stubGlobal('fetch', fetcher); render(); await displayed('Reviewed draft');
 const video = host.querySelector('video')!; Object.defineProperty(video, 'readyState', { value: 2 });
 act(() => video.dispatchEvent(new Event('loadeddata')));
 const approvals = () => [...host.querySelectorAll<HTMLButtonElement>('article button')].filter(element => element.textContent === marketingWorkspace.en.approve);
 expect(approvals().map(element => element.disabled)).toEqual([false, true]);
 await act(async () => { button(marketingWorkspace.en.refresh).click(); await client.getQueryCache().find({ queryKey: qk.marketingState })!.promise; });
 expect(approvals().map(element => element.disabled)).toEqual([true, true]);
});

for (const lang of ['en', 'cs'] as const) {
 it(`${lang}: an unconfirmed activation has one captured attempt and needs an explicit successful read`, async () => {
  m.lang = lang; const t = marketingWorkspace[lang], value = marketingStateFixture(), refreshed = structuredClone(value); refreshed.campaigns[0].status = 'active';
  let gets = 0; const posts: RequestInit[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options?: RequestInit) => { if (url === '/api/marketing/campaigns') { posts.push(options!); return Response.json({ ok: true }); } return Response.json(++gets === 1 ? value : refreshed); }));
  render(); await displayed('Reviewed draft'); act(() => host.querySelector<HTMLButtonElement>('#marketing-tab-calendar')!.click()); await displayed('Reviewed plan');
  await act(async () => { const activate = button(lang === 'cs' ? 'Použít tento plán' : 'Use this plan'); activate.focus(); activate.click(); activate.click(); await vi.waitFor(() => expect(client.getQueryState(qk.marketingState)?.isInvalidated).toBe(true)); });
  expect(posts).toHaveLength(1); expect(posts[0].headers).toEqual({ 'Content-Type': 'application/json', 'x-own-dashboard-owner': stateOwner }); expect(JSON.parse(posts[0].body as string)).toEqual({ id: value.campaigns[0].id, expectedHash: value.campaigns[0].source_hash });
  expect(host.textContent).toContain(t.activationUnconfirmed); expect(host.textContent).not.toContain(t.activationSaved); expect(gets).toBe(1);
  expect(button(lang === 'cs' ? 'Použít tento plán' : 'Use this plan').disabled).toBe(true); expect(document.activeElement).toBe(button(t.refresh));
  await act(async () => { button(t.refresh).click(); button(t.refresh).click(); await client.getQueryCache().find({ queryKey: qk.marketingState })!.promise; });
  expect(gets).toBe(2); expect(posts).toHaveLength(1); expect(host.textContent).not.toContain(t.activationUnconfirmed); expect(button(lang === 'cs' ? 'Použít tento plán' : 'Use this plan')).toBeUndefined();
 });
 it(`${lang}: confirms the exact activation and reloads its current plan once`, async () => {
  m.lang = lang; const t = marketingWorkspace[lang], value = marketingStateFixture(), refreshed = structuredClone(value); refreshed.campaigns[0].status = 'active'; let gets = 0, posts = 0;
  vi.stubGlobal('fetch', vi.fn(async url => { if (url === '/api/marketing/campaigns') { posts++; return Response.json({ ownerId: stateOwner, campaignId: value.campaigns[0].id, sourceHash: value.campaigns[0].source_hash, status: 'active' }); } return Response.json(++gets === 1 ? value : refreshed); }));
  render(); await displayed('Reviewed draft'); act(() => host.querySelector<HTMLButtonElement>('#marketing-tab-calendar')!.click());
  await act(async () => { button(lang === 'cs' ? 'Použít tento plán' : 'Use this plan').click(); await vi.waitFor(() => expect(gets).toBe(2)); await client.getQueryCache().find({ queryKey: qk.marketingState })!.promise; });
  await displayed(t.activationSaved); expect(posts).toBe(1); expect(host.textContent).not.toContain(t.activationUnconfirmed);
 });
}
it('retires an in-flight activation on unmount and leaves its cache stale without a replay', async () => {
 const value = marketingStateFixture(); let scope: AbortSignal | undefined, finish!: (response: Response) => void;
 const fetcher = vi.fn((url, options?: RequestInit) => url === '/api/marketing/campaigns' ? new Promise<Response>(resolve => { scope = options?.signal as AbortSignal; finish = resolve; }) : Promise.resolve(Response.json(value))); vi.stubGlobal('fetch', fetcher);
 render(); await displayed('Reviewed draft'); act(() => host.querySelector<HTMLButtonElement>('#marketing-tab-calendar')!.click());
 act(() => button('Use this plan').click()); await act(async () => { await vi.waitFor(() => expect(scope).toBeDefined()); });
 const exit = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(exit); expect(exit.defaultPrevented).toBe(true);
 act(() => root.render(null)); expect(scope?.aborted).toBe(true); expect(client.getQueryState(qk.marketingState)?.isInvalidated).toBe(true);
 await act(async () => { finish(Response.json({ ownerId: stateOwner, campaignId: value.campaigns[0].id, sourceHash: value.campaigns[0].source_hash, status: 'active' })); await Promise.resolve(); });
 expect(fetcher).toHaveBeenCalledTimes(2); expect(host.textContent).toBe('');
});

for (const lang of ['en', 'cs'] as const) {
 it(`${lang}: keeps an open Calendar source draft read-only after a failed refresh and restores it after recovery`, async () => {
  m.lang=lang;const t=marketingWorkspace[lang],value=marketingStateFixture();value.campaigns[0].status='active';const refused=structuredClone(value);refused.ownerId='99999999-9999-4999-8999-999999999999';
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json(value)).mockResolvedValueOnce(Response.json(refused)).mockResolvedValueOnce(Response.json(value));vi.stubGlobal('fetch',fetcher);
  render();await displayed('Reviewed draft');act(()=>host.querySelector<HTMLButtonElement>('#marketing-tab-calendar')!.click());
  act(()=>button(lang==='cs'?'Vybrat aktuální podklad':'Select current source').click());
  const dialog=document.querySelector<HTMLElement>('[role="dialog"]')!,source=dialog.querySelector('select')!,choice=source.options[1].value;
  act(()=>{source.value=choice;source.dispatchEvent(new Event('change',{bubbles:true}));});
  const localButton=(text:string)=>[...dialog.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.textContent===text)!;
  const save=localButton(calendarReleaseCopy[lang].save);expect(save.disabled).toBe(false);
  // The modal owns recovery; a background page control is inert while it is open.
  await act(async()=>{button(t.refresh).click();await client.getQueryCache().find({queryKey:qk.marketingState})!.promise?.catch(()=>undefined);});
  await displayed(t.retainedState);expect(client.getQueryState(qk.marketingState)?.status).toBe('error');expect(source.value).toBe(choice);expect(source.disabled).toBe(true);expect(save.disabled).toBe(true);
  for(const field of dialog.querySelectorAll<HTMLInputElement>('input'))expect(field.disabled).toBe(true);
  act(()=>save.click());expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async()=>{localButton(calendarReleaseCopy[lang].reload).click();await client.getQueryCache().find({queryKey:qk.marketingState})!.promise;});
  await vi.waitFor(async()=>{await act(async()=>{});expect(source.disabled).toBe(false);});expect(source.value).toBe(choice);expect(save.disabled).toBe(false);expect(fetcher).toHaveBeenCalledTimes(3);
 });
}
