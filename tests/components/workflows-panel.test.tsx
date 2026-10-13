// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowsPanel } from '@/components/panels/workflows-panel';
import { workflows, WORKFLOW_AREAS } from '@/lib/i18n/sections/workflows';
import { nav } from '@/lib/i18n/sections/nav';
import { NAV_TABS, isDashboardSlug, isHiddenNavTab, tabFromSlug, tabToPath } from '@/lib/nav-tabs';
import { dashboardDataKeysForTab, serverDataKeysForTab } from '@/lib/dashboard-data';

const context = vi.hoisted(() => ({ lang: 'en' as 'en' | 'cs' }));
vi.mock('@/lib/i18n', () => ({ useDict: () => ({ nav: nav[context.lang], workflows: workflows[context.lang] }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement; let root: Root;
const navigate = vi.fn();
beforeEach(() => { navigate.mockReset(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe('owner workflow guide', () => {
  it('covers all visible destinations without reintroducing hidden or retired areas or loading private entities', () => {
    const covered = Object.values(WORKFLOW_AREAS).flat();
    expect(new Set(covered).size).toBe(covered.length);
    expect([...covered].sort()).toEqual(NAV_TABS.filter(tab => !isHiddenNavTab(tab) && tab !== 'workflows').sort());
    expect(isDashboardSlug(['workflows'])).toBe(true); expect(tabFromSlug(['workflows'])).toBe('workflows'); expect(tabToPath('workflows')).toBe('/workflows');
    expect([...dashboardDataKeysForTab('workflows')]).toEqual([]); expect([...serverDataKeysForTab('workflows')]).toEqual([]);
  });
  it.each(['en', 'cs'] as const)('provides readable diagrams and honest holds in %s without network calls or actions', lang => {
    context.lang = lang; const fetcher = vi.spyOn(globalThis, 'fetch');
    act(() => root.render(<WorkflowsPanel onNavigate={navigate} />));
    expect(container.querySelectorAll('figure')).toHaveLength(7);
    expect(container.querySelectorAll('figure ol[aria-label]')).toHaveLength(7);
    for (const figure of container.querySelectorAll('figure')) {
      expect(figure.querySelector('figcaption')?.textContent).toBeTruthy();
      expect(figure.querySelectorAll('li').length).toBeGreaterThan(2);
      expect(figure.querySelector('p')?.textContent).toBeTruthy();
    }
    for (const section of container.querySelectorAll('section[aria-labelledby]')) expect(container.querySelector(`#${section.getAttribute('aria-labelledby')}`)).not.toBeNull();
    expect(container.textContent).toContain(workflows[lang].marketingHold);
    expect(container.textContent).toContain(workflows[lang].setup);
    expect(container.textContent).toContain(lang === 'cs' ? 'Publikování přes Meta: vypnuté' : 'Meta publishing: disabled');
    expect(container.querySelectorAll('button,input,img,iframe')).toHaveLength(0);
    const link = container.querySelector<HTMLAnchorElement>('a[href="/projects"]')!;
    act(() => link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(navigate).toHaveBeenCalledWith('projects'); expect(fetcher).not.toHaveBeenCalled();
    navigate.mockReset(); act(() => link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })));
    expect(navigate).not.toHaveBeenCalled();
  });
  it('keeps both translations structurally complete', () => {
    expect(Object.keys(workflows.en)).toEqual(Object.keys(workflows.cs));
    for (const key of Object.keys(WORKFLOW_AREAS) as Array<keyof typeof WORKFLOW_AREAS>) expect(Object.keys(workflows.en.areas[key])).toEqual(Object.keys(workflows.cs.areas[key]));
    expect(workflows.en.marketingFlows.map(flow => flow.steps.length)).toEqual(workflows.cs.marketingFlows.map(flow => flow.steps.length));
  });
});
