'use client';

import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import { readTextPrefix } from '@/lib/bounded-text';
import { databaseVersion } from '@/lib/database-version';
import { DEFAULT_DNESKAI_DAILY_MIX, DneskaiDailyMixReadSchema, DneskaiDailyMixSaveSchema, DneskaiDailyMixReceiptSchema, sameDneskaiDailyMix, type DneskaiDailyMix, type DneskaiDailyMixRead } from './dneskai-daily-mix';

/** The browser side of Zdroje → Denní mix (#156): `/api/marketing/dneskai/daily-mix`. */
export class DneskaiDailyMixRequestError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); this.name = 'DneskaiDailyMixRequestError'; }
}
const path = (projectId: string) => `/api/marketing/dneskai/daily-mix?projectId=${encodeURIComponent(projectId)}`;
const budget = (parent?: AbortSignal) => AbortSignal.any([AbortSignal.timeout(20_000), ...(parent ? [parent] : [])]);
async function json(response: Response, signal: AbortSignal): Promise<unknown> {
  const body = await awaitWithSignal(readTextPrefix(response, 4096, signal), signal);
  if (body.truncated) throw new DneskaiDailyMixRequestError('daily-mix-unavailable', response.status);
  return JSON.parse(body.text);
}
const cancelBody = (response: Response) => { void response.body?.cancel().catch(() => undefined); };

/** The mix, or null while the server has it off (404). In the preview, the default, never saved. */
export async function loadDneskaiDailyMix(projectId: string, preview: boolean, signal?: AbortSignal): Promise<DneskaiDailyMixRead | null> {
  if (preview) return { mix: DEFAULT_DNESKAI_DAILY_MIX, stored: false, version: null };
  z.uuid().parse(projectId); const deadline = budget(signal);
  deadline.throwIfAborted();
  const response = await awaitWithSignal(fetch(path(projectId), { cache: 'no-store', signal: deadline }), deadline);
  if (response.status === 404) { cancelBody(response); return null; }
  if (!response.ok) { cancelBody(response); throw new DneskaiDailyMixRequestError('daily-mix-unavailable', response.status); }
  return DneskaiDailyMixReadSchema.parse(await json(response, deadline));
}

export async function saveDneskaiDailyMix(projectId: string, mix: DneskaiDailyMix, expectedVersion: string | null, parent?: AbortSignal): Promise<DneskaiDailyMixRead> {
  z.uuid().parse(projectId); const input = DneskaiDailyMixSaveSchema.parse({ mix, expectedVersion }), signal = budget(parent);
  signal.throwIfAborted();
  let response: Response;
  try { response = await awaitWithSignal(fetch(path(projectId), { method: 'PUT', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal }), signal); }
  catch { throw new DneskaiDailyMixRequestError('daily-mix-unavailable', 0); }
  if (!response.ok) { cancelBody(response); throw new DneskaiDailyMixRequestError(response.status === 409 ? 'daily-mix-conflict' : response.status === 400 ? 'invalid-daily-mix' : 'daily-mix-unavailable', response.status); }
  const receipt = DneskaiDailyMixReceiptSchema.parse(await json(response, signal));
  const from = receipt.sourceVersion === null ? null : databaseVersion(receipt.sourceVersion), to = databaseVersion(receipt.read.version!)!;
  const expected = expectedVersion === null ? null : databaseVersion(expectedVersion);
  if (receipt.kind !== 'saved' || receipt.projectId !== projectId || !sameDneskaiDailyMix(receipt.read.mix, mix)
    || (from !== null && to < from) || (from !== to && from !== expected)) throw new DneskaiDailyMixRequestError('daily-mix-unavailable', response.status);
  return receipt.read;
}
