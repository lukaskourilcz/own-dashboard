import { qk } from '@/lib/queries/keys';
import { PublishingCalendarSchema } from '@/lib/publishing-calendar';
import { StrategyLinkSchema, StrategyReadSchema, type StrategyResultInput } from './contracts';
import type { PublishingBrand } from '@/lib/publishing-calendar';

export const strategyKey = (projectId: string, brand: PublishingBrand, preview: boolean) => [...qk.marketingStrategy, projectId, brand, preview ? 'preview' : 'live'] as const;
async function json(url: string, init?: RequestInit) {
  const r = await fetch(url, { ...init, cache: 'no-store', headers: { 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error('strategy-unavailable');
  return r.json();
}
export const loadStrategy = async (projectId: string, brand: PublishingBrand, signal?: AbortSignal) => StrategyReadSchema.parse(await json(`/api/marketing/strategy?${new URLSearchParams({ projectId, brand })}`, { signal }));
export const addStrategyIdea = async (projectId: string, brand: PublishingBrand, ideaId: string) => StrategyLinkSchema.parse(await json('/api/marketing/strategy/drafts', { method: 'POST', body: JSON.stringify({ projectId, brand, ideaId }) }));
export const saveStrategyResult = (input: StrategyResultInput) => json('/api/marketing/strategy', { method: 'POST', body: JSON.stringify(input) });
export const loadStrategyCalendar = async (signal?: AbortSignal) => PublishingCalendarSchema.parse(await json('/api/publishing-calendar', { signal }));

/** Uses the same History API navigation as the publishing calendar (including its in-memory preview). */
export function openStrategyHref(href: string) {
  window.history.pushState(null, '', href);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.dispatchEvent(new Event('project-tab'));
}
