// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DneskaiWorkspaceTab, type DneskaiWorkspaceTabId } from '@/components/marketing/dneskai/workspace';
import { DEMO_DNESKAI_PROJECT_ID, demoDneskaiWorkspaceApi, resetDemoDneskaiWorkspace } from '@/lib/demo/dneskai-workspace-demo';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import { dneskaiLab } from '@/lib/i18n/sections/dneskai-lab';
import { DNESKAI_TONE_TINTS } from '@/components/marketing/dneskai/state-chip';
import { DNESKAI_STATE_TONES } from '@/lib/marketing/dneskai-workspace';
import { dneskaiWorkspaceKeys, DneskaiWorkspaceRequestError } from '@/lib/marketing/dneskai-workspace-client';
vi.mock('@/lib/i18n', () => ({ useLang: () => ({ lang: 'en' }) }));
// A plain element stands in for next/image; the slide strips only need its src, size and alt.
vi.mock('next/image', () => ({ default: (props: Record<string, unknown>) => {
  const rest = Object.fromEntries(Object.entries(props).filter(([key]) => key !== 'unoptimized'));
  // eslint-disable-next-line @next/next/no-img-element -- test double for next/image
  return <img {...(rest as object)} alt={String(props.alt ?? '')} />;
} }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = dneskaiWorkspace.en;
// The demo's edited version saved 20 s before the read: preparing until its render attaches or the grace period ends.
const fresh = 'd0e5ca10-0000-4000-8000-000000000010';
let container: HTMLDivElement; let root: Root; let client: QueryClient;
beforeEach(() => { resetDemoDneskaiWorkspace(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(() => { act(() => root.unmount()); container.remove(); client.clear(); vi.restoreAllMocks(); });
const wait = (ms: number) => act(async () => { await new Promise((done) => setTimeout(done, ms)); });
const show = async (tab: DneskaiWorkspaceTabId) => {
  act(() => root.render(<QueryClientProvider client={client}><TooltipProvider><DneskaiWorkspaceTab tab={tab} projectId={DEMO_DNESKAI_PROJECT_ID} lang="en" preview /></TooltipProvider></QueryClientProvider>));
  await wait(400);
};
const blocked = () => container.querySelector('[data-testid="dneskai-blocked-posts"]')?.textContent ?? '';
const calendarEntry = (title: string) => [...container.querySelectorAll('[data-testid="dneskai-calendar"] li li')].find((item) => item.textContent?.includes(title));
function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')!.set!;
  act(() => { setter.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('DNESKAi tabs share the versions whose render did not attach', () => {
  it('shows a failed attach seen in review as a problem in Calendar and Errors and costs at once', async () => {
    await show('dneskai-costs');
    expect(blocked()).not.toContain('Lokální model na notebooku');
    act(() => { client.setQueryData(dneskaiWorkspaceKeys(DEMO_DNESKAI_PROJECT_ID).renderFailed, new Set([fresh])); });
    await show('dneskai-costs');
    expect(blocked()).toContain('Lokální model na notebooku');
    await show('dneskai-calendar');
    const entry = calendarEntry('Lokální model na notebooku');
    expect(entry?.textContent).toContain(t.states.problem); expect(entry?.textContent).not.toContain(t.states.preparing);
  });

  it('records the version of an edit that answered 502 render-attach-failed, and the other tabs read it', async () => {
    // The server saved the edit as a new version (the demo's fresh one, no slides yet) and then could not attach its render.
    const edit = vi.spyOn(demoDneskaiWorkspaceApi, 'edit').mockRejectedValue(new DneskaiWorkspaceRequestError('render-attach-failed', 502, fresh));
    // The Lab's fit check would call the dev-preview fitter over HTTP; the save does not wait for it.
    vi.spyOn(demoDneskaiWorkspaceApi, 'fit').mockReturnValue(new Promise(() => undefined));
    // The Lab opens on the first post in review that can still be approved: „Benchmark není žebříček“.
    await show('dneskai-review');
    const inspector = container.querySelector<HTMLElement>('[data-testid="dneskai-slide-inspector"]')!;
    const label = [...inspector.querySelectorAll('label')].find((item) => item.textContent?.startsWith(dneskaiLab.en.slide.fields.headline))!;
    type(document.getElementById(label.htmlFor) as HTMLInputElement, 'Benchmark čtěte s metodikou');
    act(() => { [...container.querySelectorAll<HTMLButtonElement>('[data-testid="dneskai-lab"] button')].find((button) => button.textContent === dneskaiLab.en.actions.save)!.click(); });
    await wait(300);
    expect(edit).toHaveBeenCalledTimes(1);
    expect(client.getQueryData<ReadonlySet<string>>(dneskaiWorkspaceKeys(DEMO_DNESKAI_PROJECT_ID).renderFailed)).toEqual(new Set([fresh]));
    // The cache entry outlives the review tab: Errors and costs and Calendar mount later and read the same set.
    await show('dneskai-costs');
    expect(blocked()).toContain('Lokální model na notebooku');
    await show('dneskai-calendar');
    const entry = calendarEntry('Lokální model na notebooku');
    expect(entry?.textContent).toContain(t.states.problem); expect(entry?.textContent).not.toContain(t.states.preparing);
  });
});

// cost-16: measured spend, booked failed-job cost and provider balances are shown apart; unknowns are words, not $0.00.
describe('Errors and costs keeps measured, booked and unknown apart', () => {
  it('shows the booked column, the unknown count and unread provider balances in the preview', async () => {
    await show('dneskai-costs');
    const costs = container.querySelector('[data-testid="dneskai-costs"]')!;
    const headers = [...costs.querySelectorAll('table thead th')].map((cell) => cell.textContent);
    expect(headers).toEqual([t.costs.date, t.costs.collection, t.costs.generation, t.costs.total, t.costs.booked]);
    const yesterday = costs.querySelectorAll('table tbody tr')[1]!;
    expect(yesterday.textContent).toContain(t.costs.unknown(1));
    // Measured total excludes the booked $0.25: 0.04 sources + 0.37 drafting.
    expect([...yesterday.querySelectorAll('td')].map((cell) => cell.textContent)).toEqual(['$0.04', '$0.37', '$0.41', '$0.25']);
    expect(costs.querySelector('table')!.getAttribute('aria-describedby')).toBe('dneskai-days-help');
    expect(costs.querySelector('#dneskai-days-help')!.textContent).toBe(t.costs.daysHelp);
    const balances = costs.querySelector('[data-testid="dneskai-balances"]')!;
    expect(balances.textContent).toContain(`${t.costs.balanceApify}:${t.costs.balanceUnknown}`);
    expect(balances.textContent).toContain(`${t.costs.balanceAnthropic}:${t.costs.balanceUnknown}`);
    expect(balances.textContent).not.toMatch(/\$/);
    expect(costs.textContent).toContain(t.costs.budgetBasis);
  });

  it('offers "give up and queue again" only on a publication the server marks requeueable, and confirms in place (approval-04)', async () => {
    const { createDneskaiCostsFixture } = await import('@/lib/demo/dneskai-workspace-fixtures');
    const base = createDneskaiCostsFixture(new Date());
    const stuck = { ...base.publications[0]!, id: 'd0e5ca10-0000-4000-8000-0000000000aa', errorCode: 'lease-expired', title: 'Zaseknutý příspěvek', requeueable: true };
    vi.spyOn(demoDneskaiWorkspaceApi, 'loadCosts').mockResolvedValue({ ...base, publications: [base.publications[0]!, stuck] });
    const requeue = vi.spyOn(demoDneskaiWorkspaceApi, 'requeuePublication').mockResolvedValue('queued');
    await show('dneskai-costs');
    const controls = container.querySelectorAll('[data-testid="dneskai-requeue"]');
    // The fixture's uncertain publication (it may have reached media_publish) gets no control.
    expect(controls).toHaveLength(1);
    const offer = [...controls[0]!.querySelectorAll('button')];
    expect(offer.map((button) => button.textContent)).toEqual([t.costs.requeue]);
    act(() => offer[0]!.click());
    expect(controls[0]!.textContent).toContain(t.costs.requeueHelp);
    const confirm = [...controls[0]!.querySelectorAll('button')].find((button) => button.textContent === t.costs.requeueConfirm)!;
    expect(confirm.getAttribute('aria-describedby')).toBe(`dneskai-requeue-${stuck.id}`);
    expect(requeue).not.toHaveBeenCalled();
    await act(async () => { confirm.click(); await new Promise((done) => setTimeout(done, 0)); });
    expect(requeue).toHaveBeenCalledExactlyOnceWith(stuck.id);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(t.costs.requeueDone);
  });
  it('shows the server refusal code when queuing again is refused', async () => {
    const { createDneskaiCostsFixture } = await import('@/lib/demo/dneskai-workspace-fixtures');
    const base = createDneskaiCostsFixture(new Date());
    vi.spyOn(demoDneskaiWorkspaceApi, 'loadCosts').mockResolvedValue({ ...base, publications: [{ ...base.publications[0]!, requeueable: true }] });
    await show('dneskai-costs');
    const control = container.querySelector('[data-testid="dneskai-requeue"]')!;
    act(() => control.querySelector('button')!.click());
    const confirm = [...control.querySelectorAll('button')].find((button) => button.textContent === t.costs.requeueConfirm)!;
    // The demo refuses as the server does for a row that may have reached media_publish.
    await act(async () => { confirm.click(); await new Promise((done) => setTimeout(done, 300)); });
    expect(control.querySelector('[role="alert"]')?.textContent).toContain(t.costs.requeueFailed);
    expect(control.querySelector('[role="alert"]')?.textContent).toContain('Instagram may already have this post');
  });

  it('keeps the new cost strings in EN and CS parity', () => {
    for (const key of ['budgetBasis', 'balances', 'balancesHelp', 'balanceApify', 'balanceAnthropic', 'balanceUnknown', 'booked', 'bookedShort', 'daysHelp',
      'requeue', 'requeueConfirm', 'requeueCancel', 'requeueHelp', 'requeueDone', 'requeueWindowPassed', 'requeueFailed'] as const) {
      expect(dneskaiWorkspace.cs.costs[key]).toBeTruthy(); expect(dneskaiWorkspace.cs.costs[key]).not.toBe(dneskaiWorkspace.en.costs[key]);
    }
  });
});

describe('Design Lab chrome (#172)', () => {
  it.each(['en', 'cs'] as const)('shows posts, not explanations: no visible heading, intro, version chip, shortcuts button, account select or recovery link (%s)', async (lang) => {
    act(() => root.render(<QueryClientProvider client={client}><TooltipProvider><DneskaiWorkspaceTab tab="dneskai-review" projectId={DEMO_DNESKAI_PROJECT_ID} lang={lang} preview /></TooltipProvider></QueryClientProvider>));
    await wait(400);
    const lab = container.querySelector<HTMLElement>('[data-testid="dneskai-lab"]')!;
    const l = dneskaiLab[lang];
    // The landmark keeps its name for screen readers only.
    expect(lab.querySelector('h2')!.className).toContain('sr-only');
    expect(lab.querySelector('h2')!.textContent).toBe(l.title);
    const refresh = lab.querySelector<HTMLButtonElement>('[data-testid="dneskai-lab-refresh"]')!;
    expect(refresh.getAttribute('aria-label')).toBe(dneskaiWorkspace[lang].refresh);
    expect(refresh.textContent).toBe('');
    const buttons = [...lab.querySelectorAll('button')].map((button) => button.textContent);
    expect(buttons).not.toContain(l.shortcuts.title);
    // No account select: no option names an @handle.
    expect([...lab.querySelectorAll('select option')].some((option) => option.textContent?.startsWith('@'))).toBe(false);
    // The version hash stays on the approve button only.
    const session = lab.querySelector<HTMLElement>('[data-testid="dneskai-lab-session"]')!;
    const hash = session.querySelector('[data-testid="dneskai-lab-approve"] .font-mono')!.textContent!;
    expect(session.textContent!.split(hash)).toHaveLength(2);
    // The stage has no visible title; the kit tiles keep an accessible legend and no help texts.
    const stage = lab.querySelector<HTMLElement>('[data-testid="dneskai-lab-stage"]')!;
    expect(stage.querySelector('h3')).toBeNull();
    expect(stage.getAttribute('aria-label')).toBeTruthy();
    const kits = lab.querySelector<HTMLElement>('[data-testid="dneskai-kit-tiles"]')!;
    expect(kits.querySelector('legend')!.className).toContain('sr-only');
    expect(kits.querySelectorAll('p')).toHaveLength(0);
  });
});

describe('state as card tint (#173)', () => {
  it('maps each state to the tone the issue names, and each tone to one tint', () => {
    expect(DNESKAI_STATE_TONES).toEqual({ published: 'success', scheduled: 'information', approved: 'information', review: 'warning', returned: 'warning', problem: 'risk', preparing: 'neutral', skipped: 'neutral' });
    expect(Object.fromEntries(Object.entries(DNESKAI_TONE_TINTS).map(([tone, classes]) => [tone, classes.split(' ')[0]]))).toEqual({
      success: 'dneskai-tint-success', information: 'dneskai-tint-information', warning: 'dneskai-tint-warning', risk: 'dneskai-tint-risk', neutral: 'dneskai-tint-neutral' });
  });

  it.each(['en', 'cs'] as const)('tints Posts cards and Lab queue cards, with the state in their name instead of a chip (%s)', async (lang) => {
    const render = (tab: DneskaiWorkspaceTabId) => act(() => root.render(<QueryClientProvider client={client}><TooltipProvider><DneskaiWorkspaceTab tab={tab} projectId={DEMO_DNESKAI_PROJECT_ID} lang={lang} preview /></TooltipProvider></QueryClientProvider>));
    render('dneskai-published');
    await wait(400);
    const rows = [...container.querySelectorAll<HTMLElement>('[data-testid="dneskai-post-row"]')];
    expect(rows.length).toBeGreaterThan(3);
    for (const row of rows) {
      const state = row.dataset.state as keyof typeof DNESKAI_STATE_TONES;
      expect(row.className).toContain(`dneskai-tint-${DNESKAI_STATE_TONES[state]}`);
      expect(row.getAttribute('aria-label')).toMatch(new RegExp(`: ${dneskaiWorkspace[lang].states[state]}$`));
      expect(row.getAttribute('title')).toBe(dneskaiWorkspace[lang].states[state]);
      expect(row.querySelector('.rounded-full')).toBeNull();
    }
    // The Lab's fit check would call the dev-preview fitter over HTTP; this test only reads the queue.
    vi.spyOn(demoDneskaiWorkspaceApi, 'fit').mockReturnValue(new Promise(() => undefined));
    render('dneskai-review');
    await wait(400);
    const queue = [...container.querySelectorAll<HTMLElement>('[data-testid="dneskai-lab-queue-post"]')];
    expect(queue.length).toBeGreaterThan(0);
    for (const card of queue) {
      const state = card.dataset.stateTone as keyof typeof DNESKAI_STATE_TONES;
      expect(card.className).toContain(`dneskai-tint-${DNESKAI_STATE_TONES[state]}`);
      expect(card.getAttribute('aria-label')).toMatch(new RegExp(`, ${dneskaiWorkspace[lang].states[state]}$`));
      expect(card.querySelector('.rounded-full')).toBeNull();
    }
  });
});

describe('channel control (#170)', () => {
  it.each(['en', 'cs'] as const)('offers Instagram and announces Threads and LinkedIn as disabled, with the reason (%s)', async (lang) => {
    vi.spyOn(demoDneskaiWorkspaceApi, 'fit').mockReturnValue(new Promise(() => undefined));
    act(() => root.render(<QueryClientProvider client={client}><TooltipProvider><DneskaiWorkspaceTab tab="dneskai-review" projectId={DEMO_DNESKAI_PROJECT_ID} lang={lang} preview /></TooltipProvider></QueryClientProvider>));
    await wait(400);
    const c = dneskaiLab[lang].channels;
    const group = container.querySelector<HTMLElement>('[data-testid="dneskai-channels"]')!;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe(c.label);
    const buttons = [...group.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent)).toEqual([c.instagram, c.threads, c.linkedin]);
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    expect(buttons.map((button) => button.getAttribute('aria-disabled'))).toEqual([null, 'true', 'true']);
    for (const button of buttons.slice(1)) expect(document.getElementById(button.getAttribute('aria-describedby')!)!.textContent).toBe(c.notConnected);
    // No List view any more: the posts list lives in Příspěvky (#169).
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'List' || button.textContent === 'Seznam')).toBe(false);
    expect(container.querySelector('[data-testid="dneskai-lab"]')).not.toBeNull();
  });
});
