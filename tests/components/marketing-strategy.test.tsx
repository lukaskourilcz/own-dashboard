// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketingStrategyTab } from '@/components/marketing/strategy/strategy-tab';
import { resetDemoMarketingStrategy } from '@/lib/demo/marketing-strategy-demo';
import { resetDemoDevsharkStudio, demoDevsharkStudio } from '@/lib/demo/devshark-studio-demo';
import { resetDemoDneskaiTopics, demoDneskaiTopicsApi } from '@/lib/demo/dneskai-topics-demo';
import { resetDemoDneskaiWorkspace } from '@/lib/demo/dneskai-workspace-demo';
import { qk } from '@/lib/queries/keys';
import { marketingStrategy } from '@/lib/i18n/sections/marketing-strategy';
const id = '00000000-0000-4000-8000-000000000050';
let root: Root, host: HTMLDivElement, cache: QueryClient;
const settle = () => act(async () => { for (let i = 0; i < 12; i++) await new Promise((resolve) => setTimeout(resolve, 10)); });
const click = async (name: string) => { const button = [...host.querySelectorAll('button')].find((b) => b.textContent === name)!; expect(button).toBeTruthy(); await act(async () => button.click()); await settle(); };
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  resetDemoMarketingStrategy(); resetDemoDevsharkStudio(); resetDemoDneskaiTopics(); resetDemoDneskaiWorkspace();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { act(() => root.unmount()); host.remove(); cache.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const render = async (brand: 'devshark' | 'dneskai', lang: 'en' | 'cs' = 'en', preview = true) => {
  await act(async () => root.render(<QueryClientProvider client={cache}><MarketingStrategyTab brand={brand} projectId={id} projectSlug={brand} lang={lang} preview={preview} /></QueryClientProvider>)); await settle();
};
describe('connected strategy workspace', () => {
  it('adds an unapproved concept to the shared Design Lab store and reopens it without a second copy or server request', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch'); await render('devshark');
    await click(marketingStrategy.en.sections.ideas);
    expect(host.querySelectorAll('details')).toHaveLength(25);
    await click(marketingStrategy.en.add);
    const drafts = (await demoDevsharkStudio.load()).drafts;
    expect(drafts).toHaveLength(2); expect(drafts[0]!.status).toBe('draft');
    expect(host.textContent).toContain(marketingStrategy.en.added);
    expect(host.textContent).toContain(marketingStrategy.en.openDraft);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('adds a proposed Czech education topic to the existing Topics store without approving it', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch'); await render('dneskai', 'cs');
    await click(marketingStrategy.cs.sections.ideas); await click(marketingStrategy.cs.addTopic);
    const read = await demoDneskaiTopicsApi.loadTopics(id);
    expect(read!.groups.education.proposed[0]!.title).toBe('Z porady udělejte seznam úkolů');
    expect(read!.groups.education.proposed[0]!.approvedAt).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps research available when live evidence fails and disables writes', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await render('devshark', 'en', false);
    expect(host.textContent).toContain(marketingStrategy.en.unavailable);
    await click(marketingStrategy.en.sections.ideas);
    expect([...host.querySelectorAll('button')].filter((b) => b.textContent === marketingStrategy.en.add).every((b) => b.disabled)).toBe(true);
    await click(marketingStrategy.en.sections.research);
    expect(host.textContent).toContain('Instagram Ranking Explained');
  });
  it('shows missing audience data without fabricated totals or winning formats', async () => {
    await render('devshark'); await click(marketingStrategy.en.sections.results);
    expect(host.textContent).toContain(marketingStrategy.en.emptyResults);
    expect(host.textContent).toContain(marketingStrategy.en.noPublications);
    expect(cache.getQueryData([...qk.marketingStrategy, id, 'devshark', 'preview'])).toMatchObject({ results: [], publications: [] });
  });
  it('keeps Apify research usable offline, distinguishes the Czech evidence gap and never starts paid work', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await render('dneskai', 'cs', false);
    await click(marketingStrategy.cs.sections.apify);
    const calls = fetch.mock.calls.length;
    const clipboard = vi.fn().mockRejectedValue(new Error('clipboard denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText: clipboard } });
    await click(marketingStrategy.cs.apify.copy);
    expect(host.textContent).toContain('neobsahuje analyzovanou skupinu českých AI konkurentů');
    expect(host.textContent).toContain('26 / 241');
    expect(host.textContent).toContain('213 / 241');
    expect(host.textContent).toContain(marketingStrategy.cs.apify.copyFailed);
    expect(host.querySelector('pre')!.textContent).toContain('nejvýše $2 na běh');
    expect(fetch.mock.calls.length).toBe(calls);
  });
});
