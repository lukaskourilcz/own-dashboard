// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DneskaiSourceList } from '@/components/marketing/dneskai-source-list';
import { ConfirmationProvider } from '@/components/ui/confirmation-dialog';
import { dneskaiSourceList } from '@/lib/i18n/sections/dneskai-source-list';
import { qk } from '@/lib/queries/keys';
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
    const fetch = vi.fn(async (url: string, init?: RequestInit) => init?.method === 'POST' ? Response.json({kind:'saved',ownerId:'11111111-1111-4111-8111-111111111111',projectId:project,sourceId:JSON.parse(String(init.body)).source.sourceId,source:JSON.parse(String(init.body)).source}) : new Response(JSON.stringify(list), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    render('cs', false);
    await vi.waitFor(async () => { await wait(0); expect(container.querySelector('form')).not.toBeNull(); });
    const t = dneskaiSourceList.cs;
    const form = container.querySelector('form')!;
    type(form.querySelector('input')!, '@NewProfile');
    expect(form.textContent).toContain(t.add.detected.instagram('newprofile'));
    await act(async () => { form.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(); await new Promise((done) => setTimeout(done, 50)); });
    const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({ action: 'save', projectId: project, expected:null,
      source: { sourceId: 'instagram:newprofile', kind: 'instagram', topic: 'education', handleOrUrl: 'newprofile', name: 'newprofile', tier: 0, weekdays: [0, 1, 2, 3, 4, 5, 6], maxItems: 10, enabled: true } });
    await vi.waitFor(async () => { await wait(0); expect(form.querySelector('[role="status"].text-success')?.textContent).toBe(t.saved); });
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

const sourceKey = [...qk.dneskaiSourceList, project, false];
const sourceFixture = () => ({ ...dneskaiRegistrySourceList(), editable: true });
const owner = '11111111-1111-4111-8111-111111111111';
const savedReceipt = (body: string) => { const action = JSON.parse(body); return Response.json({ kind: 'saved', ownerId: owner, projectId: project, sourceId: action.source.sourceId, source: action.source }); };
const submit = (form: HTMLFormElement) => act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
const ready = async () => { render('en', false); await vi.waitFor(async () => { await wait(0); expect(container.querySelector('form')).not.toBeNull(); }); return container.querySelector('form')!; };

it('retains failed adds, refuses immediate repeats and confirms a retry without another list read', async () => {
  let release!: (response: Response) => void;
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST' ? new Promise<Response>(resolve => { release = resolve; }) : Response.json(sourceFixture()));
  vi.stubGlobal('fetch', fetcher); const form = await ready(), field = form.querySelector('input')!;
  type(field, '@newsource'); act(() => { for (let i = 0; i < 2; i++) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  expect(field.readOnly).toBe(true); expect(field.value).toBe('@newsource');
  await act(async () => release(Response.json({ error: 'sources-unavailable' }, { status: 503 }))); await wait();
  expect(field.value).toBe('@newsource'); expect(form.textContent).toContain(dneskaiSourceList.en.errors['sources-unavailable']);
  const before = fetcher.mock.calls.filter(([, init]) => init?.method !== 'POST').length;
  submit(form); const post = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST').at(-1)!;
  await act(async () => release(savedReceipt(String(post[1]!.body)))); await wait();
  expect(field.value).toBe(''); expect(form.textContent).toContain(dneskaiSourceList.en.saved);
  expect(fetcher.mock.calls.filter(([, init]) => init?.method !== 'POST')).toHaveLength(before);
  expect(client.getQueryData<ReturnType<typeof sourceFixture>>(sourceKey)!.items.some(item => item.row.sourceId === 'instagram:newsource')).toBe(true);
});
it('preserves the add draft through failed and read-only list refreshes', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(sourceFixture())); vi.stubGlobal('fetch', fetcher);
  const form = await ready(), field = form.querySelector('input')!; type(field, 'https://example.com/articles.xml?lang=cs');
  fetcher.mockResolvedValue(Response.json({}, { status: 503 }));
  await act(async () => { await client.invalidateQueries({ queryKey: sourceKey }); }); await wait();
  expect(container.querySelector('form')).toBe(form); expect(field.value).toBe('https://example.com/articles.xml?lang=cs'); expect(field.readOnly).toBe(true);
  fetcher.mockResolvedValue(Response.json(dneskaiRegistrySourceList()));
  await act(async () => { await client.invalidateQueries({ queryKey: sourceKey }); }); await wait();
  expect(container.querySelector('form')).toBe(form); expect(field.value).toBe('https://example.com/articles.xml?lang=cs'); expect(field.readOnly).toBe(true);
});
it('does not let a late acknowledgement overwrite a later verified list, even after values return to their original state', async () => {
  let release!: (response: Response) => void, body = ''; const list = sourceFixture();
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => { if (init?.method !== 'POST') return Response.json(list); body = String(init.body); return new Promise<Response>(resolve => { release = resolve; }); });
  vi.stubGlobal('fetch', fetcher); const form = await ready(); type(form.querySelector('input')!, '@newsource'); submit(form);
  const original = client.getQueryData(sourceKey);
  act(() => client.setQueryData(sourceKey, { ...list, items: [] })); await wait();
  act(() => client.setQueryData(sourceKey, structuredClone(list))); await wait();
  expect(client.getQueryData(sourceKey)).not.toBe(original);
  await act(async () => release(savedReceipt(body))); await wait();
  expect(client.getQueryData(sourceKey)).toEqual(list);
});
it('aborts an unmounted mutation and ignores its late acknowledgement', async () => {
  let release!: (response: Response) => void, signal: AbortSignal | null | undefined, body = '';
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => { if (init?.method !== 'POST') return Response.json(sourceFixture()); body = String(init.body); signal = init.signal; return new Promise<Response>(resolve => { release = resolve; }); });
  vi.stubGlobal('fetch', fetcher); const form = await ready(); const original = client.getQueryData(sourceKey); type(form.querySelector('input')!, '@newsource'); submit(form);
  act(() => root.render(<div />)); expect(signal?.aborted).toBe(true); await act(async () => release(savedReceipt(body))); await wait(); expect(client.getQueryData(sourceKey)).toEqual(original);
});
it('keeps invalid edit values for correction and retains the captured draft through a list change until explicit reload', async () => {
  let list = sourceFixture(); const fetcher = vi.fn(async () => Response.json(list)); vi.stubGlobal('fetch', fetcher); await ready();
  const row = list.items[0]!.row, t = dneskaiSourceList.en;
  act(() => container.querySelector<HTMLButtonElement>(`button[aria-label="${t.editName('@' + row.handleOrUrl)}"]`)!.click()); await wait();
  const dialog = document.querySelector<HTMLElement>('[data-testid="dneskai-source-edit"]')!, form = dialog.querySelector('form')!;
  const fields = dialog.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"])'), name = fields[0]!, count = fields[1]!;
  type(name, ''); type(count, '2.5'); submit(form); expect(name.value).toBe(''); expect(count.value).toBe('2.5'); expect(dialog.textContent).toContain(t.form.itemsInvalid); expect(dialog.textContent).toContain(t.form.nameMissing);
  expect(fetcher.mock.calls).toHaveLength(1);
  type(name, 'My local draft'); type(count, '3'); list = { ...list, items: list.items.map((item, i) => i === 0 ? { ...item, row: { ...item.row, name: 'External name' } } : item) };
  await act(async () => { await client.invalidateQueries({ queryKey: sourceKey }); }); await wait();
  expect(name.value).toBe('My local draft'); expect(count.value).toBe('3'); expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  act(() => [...dialog.querySelectorAll('button')].find(button => button.textContent === t.form.reload)!.click()); await wait();
  expect(name.value).toBe('External name'); expect(count.value).toBe(String(row.maxItems)); expect(dialog.textContent).not.toContain(t.form.changed);
});
it('cancels an older in-flight list read before applying a confirmed mutation', async () => {
  let releasePost!: (response: Response) => void, releaseRead!: (response: Response) => void, body = '', readSignal: AbortSignal | undefined, reading = false;
  const list = sourceFixture();
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { body = String(init.body); return new Promise<Response>(resolve => { releasePost = resolve; }); }
    if (!reading) return Response.json(list);
    readSignal = init?.signal ?? undefined; return new Promise<Response>(resolve => { releaseRead = resolve; });
  });
  vi.stubGlobal('fetch', fetcher); const form = await ready(); type(form.querySelector('input')!, '@newsource'); submit(form);
  reading = true; act(() => { void client.invalidateQueries({ queryKey: sourceKey }); }); await wait(0); expect(readSignal?.aborted).toBe(false);
  await act(async () => releasePost(savedReceipt(body))); await wait(); expect(readSignal?.aborted).toBe(true);
  await act(async () => releaseRead(Response.json(list))); await wait();
  expect(client.getQueryData<ReturnType<typeof sourceFixture>>(sourceKey)!.items.some(item => item.row.sourceId === 'instagram:newsource')).toBe(true);
});
