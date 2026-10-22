// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DneskaiWorkspaceTab, type DneskaiWorkspaceTabId } from '@/components/marketing/dneskai/workspace';
import { DEMO_DNESKAI_PROJECT_ID, demoDneskaiWorkspaceApi, resetDemoDneskaiWorkspace } from '@/lib/demo/dneskai-workspace-demo';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
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
  act(() => root.render(<QueryClientProvider client={client}><DneskaiWorkspaceTab tab={tab} projectId={DEMO_DNESKAI_PROJECT_ID} lang="en" preview /></QueryClientProvider>));
  await wait(400);
  if (tab === 'dneskai-review') act(() => { [...container.querySelectorAll('button')].find((button) => button.textContent === 'List')?.click(); });
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
    await show('dneskai-review');
    const card = [...container.querySelectorAll<HTMLElement>('[data-testid="dneskai-post"]')].find((item) => item.querySelector('h3')?.textContent === 'Benchmark není žebříček')!;
    act(() => { [...card.querySelectorAll('button')].find((button) => button.textContent === t.card.edit)!.click(); });
    await wait(300);
    const editor = document.querySelector<HTMLElement>('[data-testid="dneskai-slide-editor"]')!;
    const label = [...editor.querySelectorAll('label')].find((item) => item.textContent === t.fields.headline)!;
    type(document.getElementById(label.htmlFor) as HTMLInputElement, 'Benchmark čtěte s metodikou');
    act(() => { document.querySelector<HTMLButtonElement>('[data-testid="dneskai-editor-main"]')!.click(); });
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
