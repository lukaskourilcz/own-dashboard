// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrategyResults } from '@/components/marketing/strategy/strategy-results';
import type { StrategyRead } from '@/lib/marketing/strategy/contracts';
const id = '11111111-1111-4111-8111-111111111111';
const read: StrategyRead = { links: [], results: [], partial: false, publications: [{ id, revisionId: id, title: 'A published lesson', channel: 'instagram', format: 'carousel', remoteUrl: 'https://www.instagram.com/p/example/' }] };
let host: HTMLDivElement, root: Root, cache: QueryClient;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); cache = new QueryClient(); });
afterEach(() => { act(() => root.unmount()); host.remove(); cache.clear(); vi.restoreAllMocks(); });
const render = async () => act(async () => root.render(<QueryClientProvider client={cache}><StrategyResults brand="devshark" projectId={id} lang="en" preview={false} read={read} unavailable={false} /></QueryClientProvider>));
const fill = async () => act(() => {
  const select = host.querySelector('select')!; select.value = id; select.dispatchEvent(new Event('change', { bubbles: true }));
  const inputs = host.querySelectorAll('input');
  const set = (input: HTMLInputElement, value: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); };
  set(inputs[0]!, '2026-11-01T12:00'); set(inputs[1]!, '2026-11-04T12:00');
  set(inputs[2]!, '100'); // Reach
  set(inputs[4]!, '0'); // Saves; views stays unknown.
  set(inputs[inputs.length - 1]!, 'Instagram Insights 2026-11-04');
});
const submit = async () => { await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); await act(async () => new Promise((r) => setTimeout(r, 30))); };
describe('manual native Insights snapshots', () => {
  it('sends measured zero and unknown distinctly and reports a saved snapshot', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    await render(); await fill(); await submit();
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
    expect(body.metrics).toMatchObject({ reach: 100, saves: 0, views: null, shares: null });
    expect(body.publicationId).toBe(id);
    expect(host.textContent).toContain('Snapshot saved.');
  });
  it('keeps entered values after a failed write so a connection problem does not lose the observation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 409 }));
    await render(); await fill(); await submit();
    expect(host.textContent).toContain('Snapshot was not saved.');
    expect(host.querySelectorAll('input')[2]!.value).toBe('100');
    expect(host.querySelectorAll('input')[4]!.value).toBe('0');
  });
});
