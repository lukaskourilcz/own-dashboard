// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Storage } from 'happy-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { OwnerPreferencesProvider } from '@/lib/owner-preferences';
import { ConfirmationProvider } from '@/components/ui/confirmation-dialog';
import { ClientsPanel } from '@/components/panels/clients-panel';
import { useLang } from '@/lib/i18n';
import { professional } from '@/lib/i18n/sections/professional';
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const receipt = () => ({ ownerId: owner, ico: '27074358', name: 'Synthetic registered name', address: 'Registry 1', city: 'Praha', zip: '140 00', country: 'Česká republika', vatId: 'CZ27074358', checkedAt: '2026-10-25T08:00:00Z' });
let root: Root | undefined, host: HTMLDivElement, client: QueryClient, release: (response: Response) => void, capturedSignal: AbortSignal | undefined;
const props = { organizations: [], setOrganizations: vi.fn(), projects: [], opportunities: [], invoices: [], invoiceItems: [], todos: [], notes: [], importantDates: [], displayCurrency: 'CZK' };
function LanguageControl() { const { setLang } = useLang(); return <button data-testid="test-language" onClick={() => setLang("cs")}>Set language</button>; }
function View({ identity = owner }: { identity?: string | null }) { const panel = <ClientsPanel {...props} />; return <QueryClientProvider client={client}><ConfirmationProvider><LanguageControl />{identity ? <OwnerPreferencesProvider ownerId={identity}>{panel}</OwnerPreferencesProvider> : panel}</ConfirmationProvider></QueryClientProvider>; }
async function render(lang: 'en' | 'cs' = 'en', identity: string | null = owner) {
 document.documentElement.lang = lang; vi.stubGlobal('localStorage', new Storage());
 vi.stubGlobal('fetch', vi.fn((_input, init) => { capturedSignal = init.signal; return new Promise<Response>(resolve => { release = resolve; }); }));
 host = document.createElement('div'); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
 await act(async () => root!.render(<View identity={identity} />));
 act(() => button(professional[lang].newClient).click()); change('input[id$="-name"]', 'Typed name'); change('#org-ico', '27074358');
}
const button = (text: string) => [...host.querySelectorAll('button')].find(node => node.textContent === text)!;
function change(selector: string, value: string) { act(() => { const input = host.querySelector<HTMLInputElement>(selector)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
const value = (selector: string) => host.querySelector<HTMLInputElement>(selector)!.value;
const finish = async (body = receipt()) => { await act(async () => { release(Response.json(body)); }); };
afterEach(() => { act(() => root?.unmount()); host?.remove(); client?.clear(); vi.unstubAllGlobals(); document.documentElement.lang = ''; capturedSignal = undefined; });
it.each(['en', 'cs'] as const)('fills only from a confirmed receipt and keeps typed address (%s)', async lang => {
 await render(lang); change('#org-address', 'Typed billing address'); act(() => button(professional[lang].fillFromAres).click()); expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
 await finish(); expect(value('input[id$="-name"]')).toBe('Synthetic registered name'); expect(value('#org-address')).toBe('Typed billing address'); expect(value('#org-city')).toBe('Praha'); expect(host.querySelector('[role="status"]')?.textContent).toBe(professional[lang].aresFilled);
});
it('refuses a late response after the registration input changes', async () => {
 await render(); act(() => button(professional.en.fillFromAres).click()); change('#org-ico', '45274649'); expect(capturedSignal?.aborted).toBe(true); await finish(); expect(value('#org-ico')).toBe('45274649'); expect(value('input[id$="-name"]')).toBe('Typed name'); expect(value('#org-city')).toBe('');
});
it('refuses a late response after the draft closes and reopens', async () => {
 await render(); act(() => button(professional.en.fillFromAres).click()); act(() => button(professional.en.newClient).click()); expect(capturedSignal?.aborted).toBe(true); act(() => button(professional.en.newClient).click()); await finish(); expect(value('input[id$="-name"]')).toBe('Typed name'); expect(value('#org-city')).toBe('');
});
it('preserves a changed name typed after the lookup started', async () => {
 await render(); act(() => button(professional.en.fillFromAres).click()); change('input[id$="-name"]', 'Newer chosen name'); await finish(); expect(value('input[id$="-name"]')).toBe('Newer chosen name'); expect(value('#org-city')).toBe('Praha');
});
it.each(['en', 'cs'] as const)('refuses a foreign receipt and retains the editable draft (%s)', async lang => {
 await render(lang); act(() => button(professional[lang].fillFromAres).click()); await finish({ ...receipt(), ownerId: other }); expect(value('input[id$="-name"]')).toBe('Typed name'); expect(value('#org-city')).toBe(''); expect(host.querySelector('[role="alert"]')?.textContent).toBe(professional[lang].aresUnavailable);
});
it('aborts a draft lookup on owner replacement without filling the next owner form', async () => {
 await render(); act(() => button(professional.en.fillFromAres).click()); await act(async () => root!.render(<View identity={other} />)); expect(capturedSignal?.aborted).toBe(true); await finish(); act(() => button(professional.en.newClient).click()); expect(value('input[id$="-name"]')).toBe('');
});
it('coalesces same-turn clicks and aborts an in-flight request on unmount', async () => {
 await render(); act(() => { const control = button(professional.en.fillFromAres); control.click(); control.click(); }); expect(fetch).toHaveBeenCalledOnce(); await act(async () => { root!.unmount(); root = undefined; }); expect(capturedSignal?.aborted).toBe(true); await finish();
});
it('does not request a private lookup without an owner scope', async () => {
 await render('en', null); act(() => button(professional.en.fillFromAres).click()); expect(fetch).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')?.textContent).toBe(professional.en.aresUnavailable);
});

it('uses the current language when a pending lookup finishes', async () => {
 await render(); act(() => button(professional.en.fillFromAres).click()); act(() => host.querySelector<HTMLButtonElement>('[data-testid="test-language"]')!.click()); await finish(); expect(host.querySelector('[role="status"]')?.textContent).toBe(professional.cs.aresFilled);
});
