import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import { readTextPrefix } from '@/lib/bounded-text';
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const outcome = z.strictObject({ count, pruned: count.optional(), error: z.string().min(1).max(300).optional() });
const receipt = z.strictObject({ ownerId: z.uuid(), startedAt: z.iso.datetime(), finishedAt: z.iso.datetime(), ok: z.literal(true), inserted: count, refreshed: count, pruned: count, sources: z.record(z.string().regex(/^(?:[A-Za-z0-9][A-Za-z0-9~_-]{0,199}|_db)$/), outcome) }).refine(value => {
 const sources = Object.values(value.sources);
 return Date.parse(value.finishedAt) >= Date.parse(value.startedAt) && sources.length > 0 && sources.length <= 30 && sources.some(source => !source.error);
});
export class CareerRefreshError extends Error {
 constructor(readonly reason: 'rate-limited' | 'unconfirmed' = 'unconfirmed') { super('Career refresh unconfirmed'); }
}
/** One explicit attempt. A timeout does not prove remote work was rolled back. */
export async function refreshCareer(scope: { ownerId: string; signal: AbortSignal }): Promise<void> {
 const { ownerId, signal: parent } = scope, lifetime = new AbortController();
 const signal = AbortSignal.any([parent, lifetime.signal, AbortSignal.timeout(60_000)]);
 let response: Response | undefined;
 const release = () => { if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined); };
 try {
  signal.throwIfAborted(); if (!z.uuid().safeParse(ownerId).success) throw new CareerRefreshError();
  const pending = fetch('/api/jobs/refresh', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal, headers: { 'x-own-dashboard-owner': ownerId } }).then(value => { response = value; if (signal.aborted) release(); return value; });
  const result = await awaitWithSignal(pending, signal); signal.throwIfAborted();
  if (!result.ok) throw new CareerRefreshError(result.status === 429 ? 'rate-limited' : 'unconfirmed');
  const prefix = await awaitWithSignal(readTextPrefix(result, 65_536, signal), signal); signal.throwIfAborted();
  if (prefix.truncated) throw new CareerRefreshError();
  const parsed = receipt.parse(JSON.parse(prefix.text));
  if (parsed.ownerId !== ownerId) throw new CareerRefreshError();
 } catch (error) {
  if (parent.aborted) throw new DOMException('Request aborted', 'AbortError');
  throw error instanceof CareerRefreshError ? error : new CareerRefreshError();
 } finally { lifetime.abort(); release(); }
}
