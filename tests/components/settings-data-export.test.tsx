// @vitest-environment happy-dom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsDataExport } from '@/components/settings-data-export';
import { OwnerPreferencesProvider } from '@/lib/owner-preferences';
import { settings } from '@/lib/i18n/sections/settings';
import { DataDownloadError } from '@/lib/data-export-download';
const state = vi.hoisted(() => ({ lang: 'en' as 'en' | 'cs', fetch: vi.fn() }));
vi.mock('@/lib/i18n', () => ({ useDict: () => ({ settings: settings[state.lang] }) }));
vi.mock('@/lib/data-export-download', async original => ({ ...await original<typeof import('@/lib/data-export-download')>(), fetchDataExport: (...args: unknown[]) => state.fetch(...args) }));
vi.mock('@/components/ui/select', () => ({ SimpleSelect: ({ id, value, options, onValueChange, disabled }: { id: string; value: string; options: { value: string; label: string }[]; onValueChange: (value: string) => void; disabled: boolean }) => <select id={id} value={value} onChange={event => onValueChange(event.target.value)} disabled={disabled}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
let root: Root, container: HTMLDivElement;
const file = () => ({ name: 'owndashboard-notes-2026-10-25.json', blob: new Blob(['{"synthetic":true}']) });
const settle = () => act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); });
function render(actor: string | null = owner, available = true) { act(() => root.render(<StrictMode>{actor ? <OwnerPreferencesProvider ownerId={actor}><SettingsDataExport available={available} /></OwnerPreferencesProvider> : <SettingsDataExport available={available} />}</StrictMode>)); }
const button = (text: string) => [...container.querySelectorAll('button')].find(node => node.textContent === text)!;
beforeEach(() => { state.lang = 'en'; state.fetch.mockReset(); delete document.documentElement.dataset.guestTour; container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-download'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {}); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {}); });
afterEach(() => { act(() => root.unmount()); container.remove(); delete document.documentElement.dataset.guestTour; vi.restoreAllMocks(); });
for (const lang of ['en', 'cs'] as const) {
 it(`${lang}: retains the selected scope after failure and retries one captured download`, async () => {
  state.lang = lang; const t = settings[lang]; state.fetch.mockRejectedValue(new Error('PRIVATE TEST diagnostic')); render();
  const select = container.querySelector('select')!; act(() => { select.value = 'notes'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => button(t.exportJson).click()); await settle(); expect(select.value).toBe('notes'); expect(container.querySelector('[role="alert"]')?.textContent).toBe(t.exportFailed); expect(container.textContent).not.toContain('PRIVATE TEST'); expect(URL.createObjectURL).not.toHaveBeenCalled();
  state.fetch.mockResolvedValue(file()); await act(async () => button(t.exportJson).click()); await settle();
  expect(state.fetch).toHaveBeenCalledTimes(2); expect(state.fetch.mock.calls[1].slice(0, 2)).toEqual([owner, 'notes']); expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.querySelector('[role="status"]')?.textContent).toBe(t.exportStarted); expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce(); expect(document.querySelector('a[download]')).toBeNull();
 });
 it(`${lang}: reserves immediately, disables every control and does not restart on language rendering`, async () => {
  state.lang = lang; const t = settings[lang]; let finish!: (value: ReturnType<typeof file>) => void; state.fetch.mockImplementation(() => new Promise(resolve => { finish = resolve; })); render();
  act(() => { button(t.exportJson).click(); button(t.exportTransactionsCsv).click(); }); expect(state.fetch).toHaveBeenCalledOnce(); expect(container.querySelector('select')!.disabled).toBe(true); expect([...container.querySelectorAll('button')].every(node => node.disabled)).toBe(true); expect(container.querySelector('[role="status"]')?.textContent).toBe(t.exportPending);
  state.lang = lang === 'en' ? 'cs' : 'en'; render(); expect(state.fetch).toHaveBeenCalledOnce(); await act(async () => finish(file())); await settle(); expect(container.querySelector('select')!.disabled).toBe(false);
 });
 it(`${lang}: shows safe size/account recovery without creating a file`, async () => {
  state.lang = lang; const t = settings[lang]; render();
  for (const [reason, copy] of [['too-large', t.exportTooLarge], ['account', t.exportAccountChanged]] as const) { state.fetch.mockRejectedValue(new DataDownloadError(reason)); await act(async () => button(t.exportJson).click()); await settle(); expect(container.querySelector('[role="alert"]')?.textContent).toBe(copy); }
  expect(URL.createObjectURL).not.toHaveBeenCalled();
 });
}
it('aborts the old owner and refuses a late browser download after owner replacement', async () => {
 let finish!: (value: ReturnType<typeof file>) => void; state.fetch.mockImplementation(() => new Promise(resolve => { finish = resolve; })); render(); act(() => button(settings.en.exportJson).click()); const signal = state.fetch.mock.calls[0][2] as AbortSignal;
 render(other); expect(signal.aborted).toBe(true); await act(async () => finish(file())); await settle(); expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(container.querySelector('[role="status"]')).toBeNull();
});
it('revokes created URLs and removes timers when leaving the panel', async () => {
 state.fetch.mockResolvedValue(file()); render(); await act(async () => button(settings.en.exportJson).click()); await settle(); expect(URL.revokeObjectURL).not.toHaveBeenCalled(); act(() => root.render(null)); expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:synthetic-download');
});
it('announces the guest boundary once without a private request or duplicate local error', () => {
 document.documentElement.dataset.guestTour = 'true'; const blocked = vi.fn(); window.addEventListener('guest-action-blocked', blocked); render();
 try { act(() => button(settings.en.exportJson).click()); expect(blocked).toHaveBeenCalledOnce(); expect(state.fetch).not.toHaveBeenCalled(); expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.querySelector('[role="status"]')).toBeNull(); } finally { window.removeEventListener('guest-action-blocked', blocked); }
});
it('does not query private data without an owner or in the ordinary preview', () => {
 for (const [actor, available] of [[null, true], [owner, false]] as const) { render(actor, available); act(() => button(settings.en.exportJson).click()); expect(container.querySelector('[role="status"]')?.textContent).toBe(settings.en.exportPreview); }
 expect(state.fetch).not.toHaveBeenCalled();
});
