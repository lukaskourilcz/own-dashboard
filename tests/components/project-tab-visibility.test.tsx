// @vitest-environment happy-dom
import { act } from 'react';
import { Storage } from 'happy-dom';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from '@/components/panels/settings-panel';
import { ProjectWorkspace } from '@/components/projects/project-workspace';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import { professional } from '@/lib/i18n/sections/professional';
import { settings } from '@/lib/i18n/sections/settings';
import type { Project } from '@/lib/types';

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
// The workspace's lazy DNESKAi tabs and sources load their own reads; a stub names the tab it was given.
vi.mock('next/dynamic', async () => {
  const { createElement } = await import('react');
  return { default: () => function DynamicStub(props: { tab?: string }) { return createElement('div', { 'data-dynamic-tab': props.tab ?? 'sources' }); } };
});
vi.mock('@/components/projects/project-links-section', () => ({ ProjectLinksSection: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement; let root: Root; let client: QueryClient;
beforeEach(() => { vi.stubGlobal('localStorage', new Storage()); localStorage.clear(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); });
afterEach(() => { act(() => root.unmount()); container.remove(); client.clear(); document.documentElement.lang = ''; vi.unstubAllGlobals(); });

const project = {
  id: 'project-dneskai', user_id: 'owner', name: 'DNESKAi', slug: 'dneskai', repo_full_name: null, url: null, notes: '', color: null,
  sort_order: 0, is_active: true, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', status: 'active', portfolio_key: 'aifirst',
} satisfies Project;
const noop = () => undefined;
const workspace = <ProjectWorkspace project={project} allProjects={[project]} costs={[]} crons={[]} todos={[]} notes={[]} setNotes={noop} invoices={[]} invoiceItems={[]}
  subscriptions={[]} subscriptionAllocations={[]} transactions={[]} organizations={[]} opportunities={[]} importantDates={[]} prompts={[]} inboxItems={[]}
  repoNotes={[]} setRepoNotes={noop} repoLinks={[]} setRepoLinks={noop} communications={[]} setCommunications={noop} aiLinks={[]} aiCategories={[]}
  projectLinks={[]} setProjectLinks={noop} promptLinks={[]} competitors={[]} setCompetitors={noop} onOpenProject={noop} displayCurrency="CZK"
  repositoryIntegrationEnabled={false} onBackToProjects={noop} isPreview />;
const render = (node: React.ReactNode) => act(() => root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
const switches = () => [...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')];
const switchNamed = (name: string) => switches().find(item => item.getAttribute('aria-label') === name);
const tabs = () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const tabNamed = (name: string) => tabs().find(item => item.textContent === name);
const click = (element: HTMLElement) => act(() => element.click());

describe('hideable DNESKAi project tabs', () => {
  it.each(['en', 'cs'] as const)('lists the DNESKAi tabs in workspace order under their own heading with distinct switch names (%s)', lang => {
    document.documentElement.lang = lang;
    render(<SettingsPanel syncPreferences={false} />);
    const tabsLabel = dneskaiWorkspace[lang].tabs; const s = settings[lang];
    const heading = [...container.querySelectorAll('p')].find(item => item.textContent === s.projectSectionsDneskai)!;
    expect(heading.className).toContain('normal-case'); expect(heading.className).not.toContain('uppercase');
    const group = container.querySelector(`ul[aria-labelledby="${heading.parentElement!.id}"]`)!;
    const rowLabel = (row: Element) => row.querySelector('span')?.textContent;
    expect([...group.querySelectorAll('li')].map(rowLabel)).toEqual([tabsLabel.review, tabsLabel.calendar, professional[lang].projectSources, tabsLabel.published, tabsLabel.costs]);

    // Each DNESKAi switch names the project, so no other switch on the page (the Navigation Calendar) shares its name.
    const names = switches().map(item => item.getAttribute('aria-label'));
    const groupNames = [...group.querySelectorAll('[role="switch"]')].map(item => item.getAttribute('aria-label'));
    expect(groupNames).toEqual([...[tabsLabel.review, tabsLabel.calendar].map(s.projectTabInDneskai), professional[lang].projectSources, ...[tabsLabel.published, tabsLabel.costs].map(s.projectTabInDneskai)]);
    for (const name of groupNames) expect(names.filter(item => item === name)).toHaveLength(1);
    expect(names).toContain(tabsLabel.calendar);
    const general = group.previousElementSibling!.previousElementSibling!;
    expect(general.tagName).toBe('UL');
    expect([...general.querySelectorAll('li')].map(rowLabel)).not.toContain(professional[lang].projectSources);
    expect([...general.querySelectorAll('li')].map(rowLabel)[0]).toBe(professional[lang].projectOverview);
  });

  it('hides a DNESKAi tab from the workspace and opens Overview when the hidden tab was open', () => {
    document.documentElement.lang = 'en';
    render(<><SettingsPanel syncPreferences={false} />{workspace}</>);
    const labels = dneskaiWorkspace.en.tabs; const p = professional.en;
    expect(tabs().map(item => item.textContent)).toEqual([p.projectOverview, labels.review, labels.calendar, p.projectSources, labels.published, labels.costs,
      p.projectTasksNotes, p.projectActivity, p.projectCommunication, p.projectRepository, p.projectFinance, expect.any(String), p.projectKnowledge, p.projectScaling, p.projectMonetization]);

    click(tabNamed(labels.calendar)!);
    expect(tabNamed(labels.calendar)!.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[data-dynamic-tab="dneskai-calendar"]')).not.toBeNull();

    const calendarSwitch = switchNamed(settings.en.projectTabInDneskai(labels.calendar))!;
    click(calendarSwitch);
    expect(calendarSwitch.getAttribute('aria-checked')).toBe('false');
    expect(JSON.parse(localStorage.getItem('hiddenProjectTabs') ?? '[]')).toEqual(['dneskai-calendar']);
    expect(tabNamed(labels.calendar)).toBeUndefined();
    expect(tabNamed(p.projectOverview)!.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[data-dynamic-tab="dneskai-calendar"]')).toBeNull();
    expect(tabs().map(item => item.textContent).slice(0, 5)).toEqual([p.projectOverview, labels.review, p.projectSources, labels.published, labels.costs]);

    // Sources hides from the DNESKAi group like the four DNESKAi tabs.
    click(switchNamed(p.projectSources)!);
    expect(tabNamed(p.projectSources)).toBeUndefined();

    click(calendarSwitch); click(switchNamed(p.projectSources)!);
    expect(JSON.parse(localStorage.getItem('hiddenProjectTabs') ?? '[]')).toEqual([]);
    expect(tabNamed(labels.calendar)).toBeDefined(); expect(tabNamed(p.projectSources)).toBeDefined();
  });
});
