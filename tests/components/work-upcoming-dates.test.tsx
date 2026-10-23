// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkOverviewPanel } from '@/components/panels/work-overview-panel';
import { professional } from '@/lib/i18n/sections/professional';
import type { ImportantDate } from '@/lib/types';
vi.mock('@/lib/i18n', () => ({ useDict: () => ({ professional: professional.en }) }));
vi.mock('@/lib/github-queries', () => ({ useCrossProjectActivityQuery: () => ({ data: { kind: 'ok', items: [] } }) }));
vi.mock('@/components/work/weekly-planning', () => ({ WeeklyPlanningFlow: () => null }));
vi.mock('@/components/work/marketing-week', () => ({ MarketingWeekCard: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026,9,23,23,30)); host=document.createElement('div'); document.body.append(host); root=createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
const date=(id:string, recurrence:boolean):ImportantDate=>({id,user_id:'owner',title:id,the_date:'2020-10-24',is_recurring:recurrence,recurrence_unit:'yearly',emoji:null,notes:null,created_at:''});
it('shows the next recurrence of an old date rather than hiding it as expired', async () => {
  await act(async () => root.render(<WorkOverviewPanel projects={[]} opportunities={[]} organizations={[]} invoices={[]} jobApplications={[]} importantDates={[date('Annual renewal',true),date('Past one-off',false)]} todos={[]} costs={[]} crons={[]} reviews={[]} setReviews={()=>{}} lastWeekCalendar={{ok:true,events:[]}} isPreview />));
  expect(host.textContent).toContain('Annual renewal');expect(host.textContent).toContain('2026-10-24');
  expect(host.textContent).not.toContain('Past one-off');expect(host.textContent).not.toContain('2020-10-24');
  vi.setSystemTime(new Date(2026,9,25,0,1));
  await act(async () => vi.advanceTimersByTime(30000));
  expect(host.textContent).toContain('2027-10-24');
});
