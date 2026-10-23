'use client';

import { DEFAULT_DNESKAI_DAILY_MIX, DneskaiDailyMixReadSchema, type DneskaiDailyMix, type DneskaiDailyMixRead } from './dneskai-daily-mix';

/** The browser side of Zdroje → Denní mix (#156): `/api/marketing/dneskai/daily-mix`. */
export class DneskaiDailyMixRequestError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); this.name = 'DneskaiDailyMixRequestError'; }
}
const path = (projectId: string) => `/api/marketing/dneskai/daily-mix?projectId=${encodeURIComponent(projectId)}`;

/** The mix, or null while the server has it off (404). In the preview, the default, never saved. */
export async function loadDneskaiDailyMix(projectId: string, preview: boolean, signal?: AbortSignal): Promise<DneskaiDailyMixRead | null> {
  if (preview) return { mix: DEFAULT_DNESKAI_DAILY_MIX, stored: false };
  const response = await fetch(path(projectId), { cache: 'no-store', signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new DneskaiDailyMixRequestError('daily-mix-unavailable', response.status);
  return DneskaiDailyMixReadSchema.parse(await response.json());
}

export async function saveDneskaiDailyMix(projectId: string, mix: DneskaiDailyMix): Promise<DneskaiDailyMixRead> {
  let response: Response;
  try { response = await fetch(path(projectId), { method: 'PUT', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mix) }); }
  catch { throw new DneskaiDailyMixRequestError('daily-mix-unavailable', 0); }
  if (!response.ok) throw new DneskaiDailyMixRequestError(response.status === 400 ? 'invalid-daily-mix' : 'daily-mix-unavailable', response.status);
  return DneskaiDailyMixReadSchema.parse(await response.json());
}
