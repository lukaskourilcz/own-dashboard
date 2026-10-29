// @vitest-environment happy-dom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CalendarImport } from '@/components/marketing/calendar-import';
import { NavigationGuardProvider } from '@/components/navigation-guard';
import { OwnerPreferencesProvider } from '@/lib/owner-preferences';
import { qk } from '@/lib/queries/keys';
import { importOwner, importPreview, importSaved } from '../lib/calendar-import-fixture';
const m = vi.hoisted(() => ({ lang: 'en', now: new Date('2026-10-28T23:15:00Z') }));
vi.mock('@/lib/i18n', async original => ({ ...await original<typeof import('@/lib/i18n')>(), useLang: () => ({ lang: m.lang }) }));
vi.mock('@/lib/use-now', () => ({ useNow: () => m.now }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient;
const imported = vi.fn();
beforeEach(() => {
 m.lang = 'en'; m.now = new Date('2026-10-28T23:15:00Z'); imported.mockReset();
 host = document.createElement('div'); document.body.append(host); root = createRoot(host);
 client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => { act(() => root.unmount()); host.remove(); client.clear(); vi.unstubAllGlobals(); });
const render = (disabled = false, owner: string | null = importOwner) => act(() => root.render(<StrictMode><QueryClientProvider client={client}><NavigationGuardProvider>{owner ? <OwnerPreferencesProvider ownerId={owner}><CalendarImport disabled={disabled} onImported={imported}/></OwnerPreferencesProvider> : <CalendarImport disabled={disabled} onImported={imported}/>}</NavigationGuardProvider></QueryClientProvider></StrictMode>));
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === text)!;
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
async function preview() { await act(async () => button(m.lang === 'cs' ? 'Zkontrolovat plán' : 'Preview plan').click()); await settle(); }
for (const lang of ['en', 'cs']) {
 it(`${lang}: freezes the Prague date, makes one captured preview/save and never claims publishing paused`, async () => {
  m.lang = lang;
  const calls: RequestInit[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => { calls.push(init!); return Response.json(JSON.parse(String(init?.body)).apply ? importSaved() : importPreview()); }));
  render(); expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('2026-10-29');
  await act(async () => { const control = button(lang === 'cs' ? 'Zkontrolovat plán' : 'Preview plan'); control.click(); control.click(); }); await settle();
  const apply = button(lang === 'cs' ? 'Importovat plán' : 'Import plan'); expect(apply).toBeDefined(); expect(document.activeElement).toBe(apply); expect(calls).toHaveLength(1);
  m.now = new Date('2026-10-30T10:00:00Z'); render(); expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('2026-10-29');
  await act(async () => { apply.click(); apply.click(); }); await settle();
  expect(calls).toHaveLength(2); expect(calls[1].headers).toMatchObject({ 'x-own-dashboard-owner': importOwner });
  expect(JSON.parse(String(calls[1].body))).toMatchObject({ expectedImportHash: 'b'.repeat(64), expectedHash: 'a'.repeat(64), startsOn: '2026-10-29' });
  expect(imported).toHaveBeenCalledOnce(); expect(host.querySelector('[role=status]')?.textContent).toContain(lang === 'cs' ? 'Import potvrzen' : 'Import confirmed');
  expect(host.textContent).not.toMatch(/publishing remains paused|publikování zůstává pozastavené/i); expect(document.activeElement).toBe(button(lang === 'cs' ? 'Zkontrolovat plán' : 'Preview plan'));
 });
 it(`${lang}: keeps the selection and requires another explicit preview after an uncertain save`, async () => {
  m.lang = lang; let posts = 0;
  vi.stubGlobal('fetch', vi.fn(async () => ++posts === 1 ? Response.json(importPreview()) : Response.json({ error: 'TEST_ONLY_PRIVATE' }, { status: 503 })));
  render(); await preview(); await act(async () => button(lang === 'cs' ? 'Importovat plán' : 'Import plan').click()); await settle();
  expect(host.querySelector('[role=alert]')?.textContent).toContain(lang === 'cs' ? 'není potvrzené' : 'unconfirmed');
  expect(button(lang === 'cs' ? 'Importovat plán' : 'Import plan')).toBeUndefined(); expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('2026-10-29'); expect(imported).not.toHaveBeenCalled(); expect(posts).toBe(2); expect(host.textContent).not.toContain('TEST_ONLY_PRIVATE');
 });
}
it.each(['disabled', 'missing-owner'] as const)('admits no private work when %s', async kind => {
 const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); render(kind === 'disabled', kind === 'missing-owner' ? null : importOwner);
 expect(button('Preview plan').disabled).toBe(true); await act(async () => button('Preview plan').click()); expect(fetcher).not.toHaveBeenCalled();
});
it('advances the default with the clock only until the first explicit choice or preview', () => {
 render(); expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('2026-10-29');
 m.now = new Date('2026-10-29T23:15:00Z'); render(); expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('2026-10-30');
});
it('clears a checked preview on a brand/date change rather than sending its old fingerprint', async () => {
 const fetcher = vi.fn(async () => Response.json(importPreview())); vi.stubGlobal('fetch', fetcher); render(); await preview();
 await act(async () => { const select = host.querySelector('select')!; select.value = 'devshark'; select.dispatchEvent(new Event('change', { bubbles: true })); });
 expect(button('Import plan')).toBeUndefined(); expect(fetcher).toHaveBeenCalledOnce();
});
it('retires an old owner during a pending preview and ignores late success', async () => {
 let finish!: (value: Response) => void; let signal: AbortSignal;
 vi.stubGlobal('fetch', vi.fn((_url: RequestInfo | URL, init?: RequestInit) => { signal = init!.signal as AbortSignal; return new Promise<Response>(resolve => { finish = resolve; }); }));
 render(); await preview(); render(false, '33333333-3333-4333-8333-333333333333'); expect(signal!.aborted).toBe(true);
 finish(Response.json(importPreview())); await settle(); expect(button('Import plan')).toBeUndefined(); expect(imported).not.toHaveBeenCalled();
});
it('guards exits while a save is pending and invalidates its captured cache after unmount', async () => {
 let finish!: (value: Response) => void; let signal: AbortSignal;
 client.setQueryData(qk.marketingState, { test: true });
 vi.stubGlobal('fetch', vi.fn((_url: RequestInfo | URL, init?: RequestInit) => JSON.parse(String(init?.body)).apply
   ? new Promise<Response>(resolve => { finish = resolve; signal = init!.signal as AbortSignal; }) : Promise.resolve(Response.json(importPreview()))));
 render(); await preview(); await act(async () => button('Import plan').click()); await settle();
 const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
 act(() => root.render(null)); expect(signal!.aborted).toBe(true); expect(client.getQueryState(qk.marketingState)?.isInvalidated).toBe(true);
 finish(Response.json(importSaved())); await settle(); expect(imported).not.toHaveBeenCalled();
});
it('retains a confirmed save if the parent calendar refresh callback throws', async () => {
 imported.mockImplementation(() => { throw new Error('TEST_ONLY_PRIVATE_CALLBACK'); });
 vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => Response.json(JSON.parse(String(init?.body)).apply ? importSaved() : importPreview())));
 render(); await preview(); await act(async () => button('Import plan').click()); await settle();
 expect(host.querySelector('[role=status]')?.textContent).toContain('Import confirmed. Refresh the calendar'); expect(host.querySelector('[role=alert]')).toBeNull();
});
it('mounts only fifty review references at a time without another request', async () => {
 const value = importPreview(); value.report.unmatchedTipTitles = Array.from({ length: 121 }, (_, i) => `Reference ${i}`);
 const fetcher = vi.fn(async () => Response.json(value)); vi.stubGlobal('fetch', fetcher); render(); await preview();
 expect(host.querySelectorAll('li')).toHaveLength(50); expect(host.textContent).toContain('Reference 0');
 await act(async () => button('Next').click()); expect(host.querySelectorAll('li')).toHaveLength(50); expect(host.textContent).toContain('Reference 50'); expect(fetcher).toHaveBeenCalledOnce();
});

it('allows navigation away from a read-only preview while cancelling its late result', async () => {
 let finish!: (value: Response) => void;
 vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
 render(); await preview();
 const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(false);
 act(() => root.render(null)); finish(Response.json(importPreview())); await settle(); expect(imported).not.toHaveBeenCalled();
});

it.each(['en', 'cs'])('%s: offers source correction after an invalid plan without a save or automatic retry', async lang => {
 m.lang = lang; const fetcher = vi.fn(async () => Response.json({ error: 'calendar-import-plan-invalid' }, { status: 400 })); vi.stubGlobal('fetch', fetcher);
 render(); await preview();
 expect(host.querySelector('[role=alert]')?.textContent).toContain(lang === 'cs' ? 'Zdrojový plán potřebuje opravu' : 'The source plan needs correction');
 const link = host.querySelector<HTMLAnchorElement>('a')!; expect(link.textContent).toBe(lang === 'cs' ? 'Otevřít zdrojový plán' : 'Open source plan');
 expect(link.href).toBe('https://boardless-ai.vercel.app/admin/calendar?venture=caught-up'); expect(link.target).toBe('_blank'); expect(link.rel).toBe('noreferrer');
 expect(button(lang === 'cs' ? 'Importovat plán' : 'Import plan')).toBeUndefined(); expect(fetcher).toHaveBeenCalledOnce(); expect(imported).not.toHaveBeenCalled();
});
it('rejects an overflowing chosen week locally with a field association and no request', async () => {
 const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); render();
 await act(async () => { const input = host.querySelector('input')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '9999-12-31'); input.dispatchEvent(new Event('input', { bubbles: true })); });
 const input = host.querySelector('input')!; expect(input.getAttribute('aria-invalid')).toBe('true'); expect(input.getAttribute('aria-describedby')).toBe(host.querySelector('[role=alert]')?.id); expect(button('Preview plan').disabled).toBe(true); expect(fetcher).not.toHaveBeenCalled();
});
