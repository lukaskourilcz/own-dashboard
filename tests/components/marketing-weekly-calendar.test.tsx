// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WeeklyMarketingCalendar } from '@/components/marketing/weekly-calendar';
import { EMPTY_MARKETING_STATE, type MarketingState } from '@/lib/marketing/client';

vi.mock('@/lib/i18n', () => ({ useLang: () => ({ lang: 'en' }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement; let root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const campaign = { id: 'campaign', brand: 'devshark', name: 'Week one', starts_on: '2026-10-18', ends_on: '2026-10-24', source_hash: 'hash', status: 'draft' };
const entry = (id: string, date: string, status = 'blocked', kind = 'carousel'): MarketingState['entries'][number] => ({ id, campaign_id: campaign.id, title: id, date, local_time: '10:00', bound_source_id: null, kind, platform: 'instagram', status, needs_review: true, capture_hash: 'd'.repeat(64) });

it('separates next-week and explicitly retained ideas from current slots, and keeps retired work recoverable', () => {
  const state: MarketingState = { ...EMPTY_MARKETING_STATE, campaigns: [campaign], entries: [entry('current-slot', '2026-10-18'), entry('later-idea', '2026-10-25', 'planned'), entry('retained-idea', '2026-10-20', 'backlog'), entry('retired-offer', '2026-10-19', 'archived')] };
  const onActivate = vi.fn();
  act(() => root.render(<WeeklyMarketingCalendar state={state} brand="devshark" lang="en" disabled={false} busy={null} onActivate={onActivate} onChanged={vi.fn()} />));
  expect(container.textContent).toContain('1 this week · 2 backlog ideas · 1 retired briefs');
  expect(container.textContent).toContain('current-slot'); expect(container.textContent).not.toContain('later-idea');
  expect(container.querySelector('details')?.textContent).toContain('retired-offer');
  const toggle = container.querySelector<HTMLButtonElement>('button[aria-pressed]')!;
  act(() => toggle.click());
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  expect(container.textContent).toContain('later-idea'); expect(container.textContent).toContain('retained-idea');
  expect(container.textContent).not.toContain('current-slot');
  expect(container.textContent).not.toContain('Use this plan'); expect(onActivate).not.toHaveBeenCalled();
});

it('never offers a carousel source action for a Story, retired entry, completed history or manual task', () => {
  const state: MarketingState = { ...EMPTY_MARKETING_STATE, campaigns: [campaign], entries: [entry('story', '2026-10-18', 'blocked', 'story'), entry('history', '2026-10-18', 'published'), entry('retired', '2026-10-18', 'archived'), entry('manual', '2026-10-18', 'planned', 'task')] };
  act(() => root.render(<WeeklyMarketingCalendar state={state} brand="devshark" lang="en" disabled onActivate={vi.fn()} busy={null} onChanged={vi.fn()} />));
  expect(container.textContent).toContain('Blocked · Story · instagram');
  expect(container.textContent).not.toContain('publishing held');
  expect(container.textContent).not.toContain('BoardlessAI');
  expect(container.textContent).not.toContain('Select current source');
  expect([...container.querySelectorAll('button')].find(button => button.textContent === 'Use this plan')?.disabled).toBe(true);
});

it.each([
  ['0001-01-01', '0001-01-07', '0001-01-08'],
  ['9999-12-25', '9999-12-31', '9999-12-24'],
])('renders the inclusive imported week %s through %s without resolving publish times', (start, end, outside) => {
  const state: MarketingState = { ...EMPTY_MARKETING_STATE, campaigns: [{ ...campaign, starts_on: start, ends_on: end }], entries: [entry('first-slot', start, 'planned', 'task'), entry('last-slot', end, 'planned', 'task'), entry('outside-slot', outside, 'planned', 'task')] };
  act(() => root.render(<WeeklyMarketingCalendar state={state} brand="devshark" lang="en" disabled busy={null} onActivate={vi.fn()} onChanged={vi.fn()} />));
  expect(container.textContent).toContain(`${start} – ${end}`);
  expect(container.textContent).toContain('2 this week · 1 backlog ideas');
  expect(container.textContent).toContain('first-slot'); expect(container.textContent).toContain('last-slot'); expect(container.textContent).not.toContain('outside-slot');
  act(() => container.querySelector<HTMLButtonElement>('button[aria-pressed]')!.click());
  expect(container.textContent).toContain('outside-slot'); expect(container.textContent).not.toContain('first-slot');
});

it('bounds week, backlog and retired rows locally while retaining all entries across pages',()=>{
 const state:MarketingState={...EMPTY_MARKETING_STATE,campaigns:[campaign],entries:[...Array.from({length:45},(_,index)=>entry(`Week ${index}`,'2026-10-18','planned','task')),...Array.from({length:45},(_,index)=>entry(`Retired ${index}`,'2026-10-18','archived','task')),...Array.from({length:45},(_,index)=>entry(`Idea ${index}`,'2026-10-25','backlog','task'))]};
 act(()=>root.render(<WeeklyMarketingCalendar state={state} brand="devshark" lang="en" disabled busy={null} onActivate={vi.fn()} onChanged={vi.fn()}/>));
 const week=()=>container.querySelector('nav[aria-label="Week entries"]')!,retired=()=>container.querySelector('nav[aria-label="Retired briefs"]')!;
 expect(container.querySelectorAll('div.divide-y > div')).toHaveLength(20);expect(container.querySelectorAll('details li')).toHaveLength(20);expect(week().textContent).toContain('1–20 of 45');expect(container.textContent).not.toContain('Week 20');
 act(()=>[...week().querySelectorAll('button')].find(item=>item.textContent==='Next')!.click());expect(week().textContent).toContain('21–40 of 45');expect(container.textContent).toContain('Week 20');expect(container.textContent).not.toContain('Week 0');
 act(()=>[...retired().querySelectorAll('button')].find(item=>item.textContent==='Next')!.click());expect(retired().textContent).toContain('21–40 of 45');expect(container.textContent).toContain('Retired 20');
 act(()=>container.querySelector<HTMLButtonElement>('button[aria-pressed]')!.click());expect(container.querySelector('nav[aria-label="Backlog entries"]')!.textContent).toContain('1–20 of 45');expect(container.textContent).toContain('Idea 0');expect(container.textContent).not.toContain('Idea 20');
});
it('keeps completed out-of-week records in bounded history rather than dropping them or making them ideas',()=>{
 const state:MarketingState={...EMPTY_MARKETING_STATE,campaigns:[campaign],entries:Array.from({length:45},(_,index)=>entry(`History ${index}`,'2026-10-25',index%2?'published':'done','task'))};act(()=>root.render(<WeeklyMarketingCalendar state={state} brand="devshark" lang="cs" disabled busy={null} onActivate={vi.fn()} onChanged={vi.fn()}/>));expect(container.textContent).toContain('0 v týdnu · 0 nápadů');expect(container.querySelectorAll('details li')).toHaveLength(20);expect(container.querySelector('summary')!.textContent).toBe('Dokončená historie (45)');expect(container.querySelector('nav')!.textContent).toContain('1–20 z 45');
});
