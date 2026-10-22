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
    for (const fact of lang === 'cs' ? [
      'každý den jeden příspěvek do Instagram feedu, dva příspěvky na Threads a tři Stories',
      'živý import do stagingu čeká na ověření', 'neaktivní návrhy se zástupným připojením',
      'Supabase pg_cron volá OwnDashboard každých pět minut', 'n8n workflows pro DNESKAi jsme vyřadili',
      'po pěti minutách, dokud běh neskončí', '„Zopakovat zařazení“ u zadání, jehož zařazení selhalo, funguje už teď',
      'Vzdálenější termíny zůstávají v backlogu', 'jsou články DNESKAi pozastavené a připravují se jen social příspěvky',
      'Dosah, uložení, sdílení ani odpovědi jsme zatím nezměřili', 'schválení přesných verzí',
      'Kontrola přesného příspěvku v Design Labu na kartě „Dnes ke schválení“ projektu DNESKAi',
      '„Přesunout na další volný čas“ a „Uvolnit zprávy“ zůstávají vypnuté', 'neuložený náhled za 0 $: bez volání modelu a bez uloženého souboru',
      'Schválit můžete jen uloženou verzi', '„Vzdát a zařadit znovu“ v Chybách a nákladech', 'tato akce zůstává vypnutá',
      'jen přesně schválenou verzi a jen při zapnutém publikování', 'devShark zatím nemá aktivní plán publikování',
      'Implementaci jsme ověřili 22. října 2026',
      'Nejvýše čtyři události podle placené klasifikace Jev', 'žádná událost se nevybere a nevznikne žádné zadání ani příspěvek',
      'Publikování se nepřeskakuje: dokud je vypnuté, běží jen jako zkušební běh bez zápisu do Meta',
      'Sběr běží každou noc od 21. října 2026; živé publikování zůstane vypnuté až do dne pilotu',
    ] : [
      'one Instagram feed post, two Threads posts and three Stories per day',
      'live staging import is awaiting verification', 'inactive drafts with placeholder connections',
      'Supabase pg_cron calls OwnDashboard every five minutes', 'The DNESKAi n8n workflows are retired',
      'every five minutes until the run is finished', '“Retry queueing” for a brief whose admission failed works today',
      'Later dates stay in the backlog', 'DNESKAi articles are paused and only social posts are prepared',
      'Reach, saves, shares and replies have not been collected', 'exact owner approval',
      'Exact post review in the Design Lab on the DNESKAi project’s “For review today” tab',
      '“Move to next free slot” and “Release reports” stay switched off', 'unsaved draft preview for $0: no model call, no stored file',
      'You can approve only a saved version', '“Give up and queue again” in Errors and costs', 'this action stays switched off',
      'only the exact approved version and only while publishing is switched on', 'devShark has no active publishing schedule yet',
      'Implementation reviewed on 22 October 2026',
      'Up to four events chosen by the paid Jev classification', 'no event is selected and no brief or post is made',
      'Publishing is never skipped: while it is switched off, it runs only as a dry run with no Meta write',
      'Collection has run every night since 21 October 2026; live publishing stays switched off until the pilot day',
    ]) expect(container.textContent).toContain(fact);
    // n8n no longer schedules or coordinates anything, and BoardlessAI writes no DNESKAi article.
    expect(container.textContent).not.toMatch(lang === 'cs' ? /n8n řídí|do 23:55|článek z BoardlessAI|zkontrolované články DNESKAi/ : /n8n coordinates|until 23:55|article from BoardlessAI|reviewed DNESKAi articles/);
    // Events, and everything after them, depend on the paid Jev classification; no copy may hide it.
    expect(container.textContent).not.toMatch(lang === 'cs' ? /Jev vyhodnocuje relevanci/ : /Jev evaluates relevance/);
    // Publishing is never a skipped step: switched off, it is a dry run.
    expect(container.textContent).not.toMatch(lang === 'cs' ? /vypnutý krok se přeskočí|publikování mají vlastní vypínač/ : /step that is switched off is skipped|publishing each have their own switch/);
    // Claude Design is devShark's layout only; DNESKAi renders through the studio bundled into OwnDashboard.
    expect(workflows[lang].marketingFlows[2]!.steps[2]).toMatch(/^devShark: .*Claude Design[^;]*; DNESKAi: .*Editorial/);
    expect(container.textContent).not.toMatch(lang === 'cs' ? /nula ze čtyř témat/ : /zero of four topics/);
    // Marketing points DNESKAi review to its project tab.
    for (const text of [workflows[lang].areas.marketing.owner, workflows[lang].nextDescription]) expect(text).toContain(lang === 'cs' ? '„Dnes ke schválení“' : '“For review today”');
    // The DNESKAi review lives in its project workspace; only devShark still reviews in Marketing.
    expect(workflows[lang].marketingFlows[0]!.steps.join(' ')).not.toMatch(/Marketing/);
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
