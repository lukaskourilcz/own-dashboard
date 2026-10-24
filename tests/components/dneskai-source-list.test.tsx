// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DneskaiSourceList } from '@/components/marketing/dneskai-source-list';
import { ConfirmationProvider } from '@/components/ui/confirmation-dialog';
import { dneskaiSourceList } from '@/lib/i18n/sections/dneskai-source-list';
import { dneskaiRegistrySourceList } from '@/lib/marketing/dneskai-source-list';
vi.mock('@/lib/i18n', () => ({ useLang: () => ({ lang: 'cs' }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const project = '22222222-2222-4222-8222-222222222222';
let container: HTMLDivElement; let root: Root; let client: QueryClient;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(() => { act(() => root.unmount()); container.remove(); client.clear(); vi.unstubAllGlobals(); });
const wait = (ms = 50) => act(async () => { await new Promise((done) => setTimeout(done, ms)); });
const render = (lang: 'en' | 'cs', preview: boolean) => act(() => root.render(<QueryClientProvider client={client}><ConfirmationProvider><DneskaiSourceList projectId={project} lang={lang} preview={preview} /></ConfirmationProvider></QueryClientProvider>));
function type(field: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('Zdroje source list (#174)', () => {
  it.each(['en','cs'] as const)('explains a bare website and an explicit dotted handle before saving (%s)',async(lang)=>{
    const list={...dneskaiRegistrySourceList(),editable:true},fetcher=vi.fn().mockResolvedValue(Response.json(list));vi.stubGlobal('fetch',fetcher);
    render(lang,false);await vi.waitFor(async()=>{await wait(0);expect(container.querySelector('form')).not.toBeNull();});
    const form=container.querySelector('form')!,field=form.querySelector('input')!,t=dneskaiSourceList[lang].add;
    type(field,'example.com');expect(form.textContent).toContain(t.detected.html('example.com'));
    type(field,'@meta.ai');expect(form.textContent).toContain(t.detected.instagram('meta.ai'));
    type(field,'https://instagram.com/profile/reels/');expect(form.textContent).not.toContain(t.detected.instagram('profile'));
    expect(fetcher.mock.calls.every(([,init])=>!init?.method||init.method==='GET')).toBe(true);
  });
  it.each(['en', 'cs'] as const)('lists Instagram profiles and websites read-only in the preview (%s)', async (lang) => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    render(lang, true); await wait();
    const t = dneskaiSourceList[lang];
    const instagram = container.querySelector('[data-testid="dneskai-sources-instagram"]')!;
    const web = container.querySelector('[data-testid="dneskai-sources-web"]')!;
    expect(instagram.querySelector('h3')!.textContent).toContain(t.instagram);
    expect(web.querySelector('h3')!.textContent).toContain(t.web);
    const registry = dneskaiRegistrySourceList();
    expect(instagram.querySelectorAll('li')).toHaveLength(registry.items.filter((item) => item.row.kind === 'instagram').length);
    expect(web.querySelectorAll('li')).toHaveLength(registry.items.filter((item) => item.row.kind !== 'instagram').length);
    expect(container.textContent).toContain(t.preview);
    expect(container.querySelector('form')).toBeNull();
    const switches = [...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')];
    expect(switches.every((item) => item.disabled)).toBe(true);
    expect(switches.find((item) => item.getAttribute('aria-label') === t.readSwitch('@aimanie'))!.getAttribute('aria-checked')).toBe('false');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('adds an Instagram profile through the owner route when editing is on', async () => {
    const list = { ...dneskaiRegistrySourceList(), editable: true };
    const fetch = vi.fn(async (url: string, init?: RequestInit) => init?.method === 'POST' ? new Response(JSON.stringify({ ok: true }), { status: 200 }) : new Response(JSON.stringify(list), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    render('cs', false);
    await vi.waitFor(async () => { await wait(0); expect(container.querySelector('form')).not.toBeNull(); });
    const t = dneskaiSourceList.cs;
    const form = container.querySelector('form')!;
    type(form.querySelector('input')!, '@NewProfile');
    expect(form.textContent).toContain(t.add.detected.instagram('newprofile'));
    await act(async () => { form.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(); await new Promise((done) => setTimeout(done, 50)); });
    const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({ action: 'save', projectId: project,
      source: { sourceId: 'instagram:newprofile', kind: 'instagram', topic: 'education', handleOrUrl: 'newprofile', name: 'newprofile', tier: 0, weekdays: [0, 1, 2, 3, 4, 5, 6], maxItems: 10, enabled: true } });
    await vi.waitFor(async () => { await wait(0); expect(container.querySelector('[aria-live="polite"] [role="status"]')?.textContent).toBe(t.saved); });
    // A source already in the list is refused before any request.
    type(form.querySelector('input')!, 'mosseri');
    await act(async () => { form.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(); });
    expect(form.textContent).toContain(t.add.exists);
  });

  it('keeps every string in English and Czech', () => {
    const keys = (value: object): string[] => Object.entries(value).flatMap(([key, item]) => typeof item === 'object' && item && !Array.isArray(item) ? keys(item).map((inner) => `${key}.${inner}`) : [key]);
    expect(keys(dneskaiSourceList.cs).sort()).toEqual(keys(dneskaiSourceList.en).sort());
  });
});


it.each(['en', 'cs'] as const)('filters registry sources by kind and search without a server request (%s)', async lang => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  render(lang, true); await wait();
  const field = container.querySelector<HTMLInputElement>('input[type="search"]')!;
  type(field, 'mosseri');
  expect(container.querySelectorAll('[data-testid="dneskai-source-row"]')).toHaveLength(1);
  const filter = container.querySelector<HTMLSelectElement>('select')!;
  act(() => { filter.value = 'web'; filter.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(container.querySelectorAll('[data-testid="dneskai-source-row"]')).toHaveLength(0);
  expect(container.textContent).toContain(dneskaiSourceList[lang].noMatches);
  expect(fetcher).not.toHaveBeenCalled();
});
