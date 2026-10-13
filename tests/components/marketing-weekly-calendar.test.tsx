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
const entry = (id: string, date: string, status = 'blocked', kind = 'carousel'): MarketingState['entries'][number] => ({ id, campaign_id: campaign.id, title: id, date, local_time: '10:00', bound_source_id: null, kind, platform: 'instagram', status, needs_review: true });

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
  expect(container.textContent).toContain('Stories: publishing held');
  expect(container.textContent).not.toContain('Select current source');
  expect([...container.querySelectorAll('button')].find(button => button.textContent === 'Use this plan')?.disabled).toBe(true);
});
