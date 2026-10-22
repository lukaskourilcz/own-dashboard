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

/** An owner recovery request (C3, briefs-07): a brief action, or re-review of one held report. */
export type DneskaiRecoveryRequest = { action: 'retry' | 'reslot' | 'release'; briefId: string } | { action: 'release'; projectId: string; candidateId: string };
export class DneskaiRecoveryRequestError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'DneskaiRecoveryRequestError'; }
}
/** Posts one recovery action. A refusal carries only its code; server detail never reaches the UI. */
export async function postDneskaiRecovery(request: DneskaiRecoveryRequest): Promise<void> {
  const url = 'candidateId' in request ? '/api/marketing/dneskai/candidates' : '/api/marketing/dneskai/briefs';
  let response: Response;
  try { response = await fetch(url, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) }); }
  catch { throw new DneskaiRecoveryRequestError('recovery-unavailable'); }
  if (response.ok) return;
  let code = 'recovery-unavailable';
  try { const body = await response.json() as { error?: unknown }; if (typeof body.error === 'string' && /^[a-z0-9-]{1,64}$/.test(body.error)) code = body.error; } catch { /* the generic code stays */ }
  throw new DneskaiRecoveryRequestError(code);
}
