// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DneskaiWorkspaceTab, type DneskaiWorkspaceTabId } from '@/components/marketing/dneskai/workspace';
import { DEMO_DNESKAI_PROJECT_ID, resetDemoDneskaiWorkspace } from '@/lib/demo/dneskai-workspace-demo';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import { dneskaiWorkspaceKeys } from '@/lib/marketing/dneskai-workspace-client';
vi.mock('@/lib/i18n', () => ({ useLang: () => ({ lang: 'en' }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = dneskaiWorkspace.en;
// The demo's edited version saved 20 s before the read: preparing until its render attaches or the grace period ends.
const fresh = 'd0e5ca10-0000-4000-8000-000000000010';
let container: HTMLDivElement; let root: Root; let client: QueryClient;
beforeEach(() => { resetDemoDneskaiWorkspace(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(() => { act(() => root.unmount()); container.remove(); client.clear(); });
const show = async (tab: DneskaiWorkspaceTabId) => {
  act(() => root.render(<QueryClientProvider client={client}><DneskaiWorkspaceTab tab={tab} projectId={DEMO_DNESKAI_PROJECT_ID} lang="en" preview /></QueryClientProvider>));
  await act(async () => { await new Promise((done) => setTimeout(done, 400)); });
};

describe('DNESKAi tabs share the versions whose render did not attach', () => {
  it('shows a failed attach seen in review as a problem in Calendar and Errors and costs at once', async () => {
    await show('dneskai-costs');
    expect(container.querySelector('[data-testid="dneskai-blocked-posts"]')?.textContent ?? '').not.toContain('Lokální model na notebooku');
    act(() => { client.setQueryData(dneskaiWorkspaceKeys(DEMO_DNESKAI_PROJECT_ID).renderFailed, new Set([fresh])); });
    await show('dneskai-costs');
    expect(container.querySelector('[data-testid="dneskai-blocked-posts"]')?.textContent).toContain('Lokální model na notebooku');
    await show('dneskai-calendar');
    const entry = [...container.querySelectorAll('[data-testid="dneskai-calendar"] li li')].find((item) => item.textContent?.includes('Lokální model na notebooku'));
    expect(entry?.textContent).toContain(t.states.problem); expect(entry?.textContent).not.toContain(t.states.preparing);
  });
});
