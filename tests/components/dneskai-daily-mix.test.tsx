// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DneskaiDailyMixPanel } from '@/components/marketing/dneskai-daily-mix';
import { dneskaiDailyMix } from '@/lib/i18n/sections/dneskai-daily-mix';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = dneskaiDailyMix.en, project = '22222222-2222-4222-8222-222222222222';
let container: HTMLDivElement; let root: Root; let client: QueryClient;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(() => { act(() => root.unmount()); container.remove(); client.clear(); vi.unstubAllGlobals(); });
const wait = (ms = 100) => act(async () => { await new Promise((done) => setTimeout(done, ms)); });
const show = async (preview = false) => { act(() => root.render(<QueryClientProvider client={client}><DneskaiDailyMixPanel projectId={project} lang="en" preview={preview} /></QueryClientProvider>)); await wait(); };
const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const change = (select: HTMLSelectElement, value: string) => act(() => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value); select.dispatchEvent(new Event('change', { bubbles: true })); });

describe('Zdroje → Denní mix (#156)', () => {
  it('renders nothing while the server has the mix off', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(404, { error: 'not-found' })));
    await show();
    expect(container.innerHTML).toBe('');
  });

  it('shows the default, refuses more posts than active times, and saves a valid mix', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'PUT' ? respond(200, { mix: JSON.parse(String(init.body)), stored: true }) : respond(200, { mix: { newsPerDay: 1, educationPerDay: 1, slots: ['08:00', '17:00'] }, stored: false }));
    vi.stubGlobal('fetch', fetcher);
    await show();
    expect(container.textContent).toContain(t.defaultNote);
    const [news, education] = [...container.querySelectorAll('select')] as HTMLSelectElement[];
    change(education!, '2');
    expect(container.textContent).toContain(t.tooFew(3, 2));
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    const twelve = [...container.querySelectorAll('label')].find((label) => label.textContent?.includes('12:30'))!;
    act(() => twelve.querySelector<HTMLButtonElement>('button[role="checkbox"]')!.click());
    expect(container.textContent).not.toContain(t.tooFew(3, 3));
    change(news!, '0');
    act(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await wait();
    const put = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(String(put[1]!.body))).toEqual({ newsPerDay: 0, educationPerDay: 2, slots: ['08:00', '12:30', '17:00'] });
    expect(container.textContent).toContain(t.saved);
  });

  it('saves nothing in the preview', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await show(true);
    expect(container.textContent).toContain(t.preview);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });
});


it('explains a disabled mix on its direct destination instead of leaving a blank panel', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => respond(404, { error: 'not-found' })));
  act(() => root.render(<QueryClientProvider client={client}><DneskaiDailyMixPanel projectId={project} lang="en" showDisabled /></QueryClientProvider>)); await wait();
  expect(container.querySelector('[role="status"]')?.textContent).toBe(t.disabled);
  expect(container.querySelector('form')).toBeNull();
});
