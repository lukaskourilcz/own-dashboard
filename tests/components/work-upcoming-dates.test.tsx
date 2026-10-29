// @vitest-environment happy-dom
import { act } from 'react';
import { renderToString } from 'react-dom/server';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkOverviewPanel } from '@/components/panels/work-overview-panel';
import { professional } from '@/lib/i18n/sections/professional';
import { common } from '@/lib/i18n/sections/common';
import type { Cron, ImportantDate, Project, Todo } from '@/lib/types';
const language = vi.hoisted(() => ({ value: 'en' as 'en' | 'cs' }));
vi.mock('@/lib/i18n', () => ({ useDict: () => ({ professional: professional[language.value], common: common[language.value] }), useLang: () => ({ lang: language.value }) }));
vi.mock('@/lib/github-queries', () => ({ useCrossProjectActivityQuery: () => ({ data: { kind: 'ok', items: [], scope: { projects: 0, totalProjects: 0, repositories: 0, unavailableRepositories: 0 } } }) }));
vi.mock('@/components/work/weekly-planning', () => ({ WeeklyPlanningFlow: () => null }));
vi.mock('@/components/work/marketing-week', () => ({ MarketingWeekCard: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => { language.value = "en"; vi.useFakeTimers(); vi.setSystemTime(new Date(2026,9,23,23,30)); host=document.createElement('div'); document.body.append(host); root=createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
const date=(id:string, recurrence:boolean):ImportantDate=>({id,user_id:'owner',title:id,the_date:'2020-10-24',is_recurring:recurrence,recurrence_unit:'yearly',emoji:null,notes:null,created_at:''});
it('shows the next recurrence of an old date rather than hiding it as expired', async () => {
  await act(async () => root.render(<WorkOverviewPanel ownerId="11111111-1111-4111-8111-111111111111" projects={[]} opportunities={[]} organizations={[]} invoices={[]} jobApplications={[]} importantDates={[date('Annual renewal',true),date('Past one-off',false)]} todos={[]} costs={[]} crons={[]} reviews={[]} setReviews={()=>{}} lastWeekCalendar={{ok:true,events:[]}} isPreview />));
  expect(host.textContent).toContain('Annual renewal');expect(host.textContent).toContain('2026-10-24');
  expect(host.textContent).not.toContain('Past one-off');expect(host.textContent).not.toContain('2020-10-24');
  vi.setSystemTime(new Date(2026,9,25,0,1));
  await act(async () => vi.advanceTimersByTime(30000));
  expect(host.textContent).toContain('2027-10-24');
});

const project: Project = { id: 'p1', user_id: 'owner', name: 'Clock project', slug: 'clock-project', repo_full_name: null, url: null, notes: '', color: null, sort_order: 0, is_active: true, status: 'active', created_at: '', updated_at: '' };
const task: Todo = { id: 't1', user_id: 'owner', title: 'Due today', done: false, due_date: '2026-10-23', category: null, created_at: '', source: 'manual', repo_id: null, repo_full_name: null, repo_owner: null, repo_name: null, repo_url: null, needed_raw: null, generated_at: null, importance: 3, project_id: project.id };
const cron: Cron = { id: 'c1', user_id: 'owner', project_id: project.id, name: 'Hourly run', schedule: '0 * * * *', description: '', endpoint: '', is_ai_call: false, cost_per_run: 0, currency: 'USD', runs_per_month: 720, enabled: true, last_run_at: null, heartbeat_url: 'https://example.test/heartbeat', last_success_at: new Date(2026,9,23,22).toISOString(), created_at: '', updated_at: '' };
// Keep the same arrays across clock ticks: data replacement must not be needed.
const props = { ownerId: "11111111-1111-4111-8111-111111111111", projects: [project], opportunities: [], organizations: [], invoices: [], jobApplications: [], importantDates: [], todos: [task], costs: [], crons: [cron], reviews: [], setReviews: () => {}, lastWeekCalendar: { ok: true as const, events: [] }, isPreview: true };
for (const lang of ['en', 'cs'] as const) it(`${lang}: refreshes overdue and heartbeat warnings on the clock without changed inputs`, async () => {
  language.value = lang;
  await act(async () => root.render(<WorkOverviewPanel {...props} />));
  const copy = professional[lang];
  expect(host.textContent).toContain(copy.attentionEmpty);
  expect(host.textContent).not.toContain(`${copy.overdueTasks}: 1`);
  vi.setSystemTime(new Date(2026,9,24,2,1));
  await act(async () => vi.advanceTimersByTime(30000));
  expect(host.textContent).toContain(`${copy.overdueTasks}: 1`);
  expect(host.textContent).toContain(`${copy.missedHeartbeat}: 1`);
  expect(host.textContent).not.toContain(copy.attentionEmpty);
  if (lang === 'cs') expect(host.textContent).not.toContain('automation missed its heartbeat');
});
it('does not claim a healthy attention list or a dated review window before hydration', () => {
  const html = renderToString(<WorkOverviewPanel {...props} />);
  expect(html).toContain(common.en.loading); expect(html).not.toContain(professional.en.attentionEmpty);
  expect(html).not.toContain(professional.en.shippedSinceReviewDescription);
});
