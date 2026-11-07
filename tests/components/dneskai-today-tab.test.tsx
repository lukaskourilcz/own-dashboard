// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DneskaiWorkspaceTab } from '@/components/marketing/dneskai/workspace';
import { DneskaiTodayTab } from '@/components/marketing/dneskai/today-tab';
import { DEMO_DNESKAI_PROJECT_ID } from '@/lib/demo/dneskai-workspace-demo';
import { createDneskaiPlanFixture } from '@/lib/demo/dneskai-plan-fixtures';
import { dneskaiToday } from '@/lib/i18n/sections/dneskai-today';
vi.mock('@/lib/i18n', () => ({ useLang: () => ({ lang: 'en' }) }));
vi.mock('next/image', () => ({ default: (props: Record<string, unknown>) => {
  const rest = Object.fromEntries(Object.entries(props).filter(([key]) => key !== 'unoptimized'));
  // eslint-disable-next-line @next/next/no-img-element -- test double for next/image
  return <img {...(rest as object)} alt={String(props.alt ?? '')} />;
} }));
vi.mock('next/navigation', () => ({ usePathname: () => '/dev-preview' }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = dneskaiToday.en;
let container: HTMLDivElement; let root: Root; let client: QueryClient;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(() => { act(() => root.unmount()); container.remove(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const wait = (ms: number) => act(async () => { await new Promise((done) => setTimeout(done, ms)); });
const slots = () => [...container.querySelectorAll<HTMLElement>('[data-testid="dneskai-today-slot"]')];

describe('Today and tomorrow in the preview', () => {
  it('shows both days with their counts, slides and texts and never calls a server', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    act(() => root.render(<QueryClientProvider client={client}><TooltipProvider><DneskaiWorkspaceTab tab="dneskai-today" projectId={DEMO_DNESKAI_PROJECT_ID} lang="en" preview /></TooltipProvider></QueryClientProvider>));
    await wait(400);
    const days = [...container.querySelectorAll('[data-testid="dneskai-today-day"]')];
    expect(days).toHaveLength(2);
    expect(days[0]!.querySelector('h3')!.textContent).toMatch(/^Today · /);
    expect(days[1]!.querySelector('h3')!.textContent).toMatch(/^Tomorrow · /);
    expect(days[0]!.textContent).toContain(t.counts(3, 4));
    expect(slots()).toHaveLength(8);
    const strip = container.querySelector('[data-testid="dneskai-today-slides"]')!;
    expect(strip.getAttribute('tabindex')).toBe('0');
    expect(strip.querySelectorAll('img')[0]!.getAttribute('alt')).not.toBe('');
    expect(container.textContent).toContain(t.threadsText);
    expect(container.querySelector('[data-testid="dneskai-threads-missing"]')?.textContent).toBe(t.threadsMissing);
    expect(container.querySelectorAll('[data-testid="dneskai-plan-day"]')).toHaveLength(30);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('opens a slot in the Design Lab on the review tab', async () => {
    act(() => root.render(<QueryClientProvider client={client}><DneskaiWorkspaceTab tab="dneskai-today" projectId={DEMO_DNESKAI_PROJECT_ID} lang="en" preview /></QueryClientProvider>));
    await wait(400);
    const listener = vi.fn(); window.addEventListener('project-tab', listener);
    const button = container.querySelector<HTMLButtonElement>(`[aria-label="${t.openLabName('Benchmark není žebříček')}"]`)!;
    act(() => button.click());
    const params = new URLSearchParams(window.location.search);
    expect(params.get('projectTab')).toBe('dneskai-review');
    expect(params.get('labPost')).toBe('d0e5ca10-0000-4000-8000-000000000001');
    expect(params.get('labSlide')).toBe('0');
    expect(params.get('labView')).toBe('studio');
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('project-tab', listener);
  });
});

describe('Today and tomorrow states', () => {
  it('says when the plan is off and collapses a long text behind a toggle', () => {
    const read = { ...createDneskaiPlanFixture(new Date('2026-11-07T09:00:00Z')), enabled: false };
    act(() => root.render(<DneskaiTodayTab read={read} month="loading" lang="en" preview={false} refreshing={false} onRefresh={() => undefined} />));
    expect(container.querySelector('[data-testid="dneskai-plan-off"]')?.textContent).toBe(t.planOff);
    expect(container.textContent).toContain(t.plan.loading);
    const toggle = [...container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')][0]!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    act(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe(t.showLess);
  });

  it('shows the error code of a failed slot and a day without slots', () => {
    const base = createDneskaiPlanFixture(new Date('2026-11-07T09:00:00Z'));
    const read = { ...base, slots: base.slots.filter((slot) => slot.date === base.today) };
    act(() => root.render(<DneskaiTodayTab read={read} month="unavailable" lang="en" preview={false} refreshing={false} onRefresh={() => undefined} />));
    expect(container.textContent).toContain(t.emptyDay);
    expect(container.textContent).toContain(t.plan.unavailable);
    expect(slots().find((slot) => slot.dataset.status === 'approved')?.textContent).toContain(t.view.threads);
  });
});
