import { DneskaiCollectionStateSchema, type DneskaiSource } from './dneskai-contracts';
import { DneskaiMediaReadSchema } from './dneskai-media-contracts';
import { pragueMarketingDate } from './weekly-planning';
import { pragueScheduledAt } from './clock';

export function sourceExternalUrl(value: string): string | null {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function nextDneskaiSourceCheck(source: Pick<DneskaiSource, 'weekdays'>, now: Date): string {
  const today = pragueMarketingDate(now);
  for (let offset = 0; offset < 8; offset++) {
    const date = new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
    if (!source.weekdays.includes(new Date(`${date}T12:00:00Z`).getUTCDay())) continue;
    const planned = pragueScheduledAt(date, '22:00');
    if (Date.parse(planned) >= now.getTime()) return planned;
  }
  throw new Error('source-check-calendar-unavailable');
}
export async function loadDneskaiSources(projectId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/marketing/dneskai/sources?projectId=${encodeURIComponent(projectId)}`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error('dneskai-source-state-unavailable');
  const state = DneskaiCollectionStateSchema.parse(await response.json());
  if (state.sources.length > 200 || state.sourceStates.length > 200) throw new Error('dneskai-source-state-unavailable');
  return state;
}
/** The media tray of one candidate, or of the currently selected candidates when none is named (#114). */
export async function loadDneskaiMedia(projectId: string, candidateId?: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ projectId, ...(candidateId ? { candidateId } : {}) });
  const response = await fetch(`/api/marketing/dneskai/media?${query}`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error('dneskai-media-unavailable');
  return DneskaiMediaReadSchema.parse(await response.json());
}
