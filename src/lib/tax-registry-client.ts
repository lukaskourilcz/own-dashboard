import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import { boundedResponseText } from '@/lib/bounded-response';
import { AresLookupSchema, ViesLookupSchema, isValidIco, normalizeIco, normalizeVatId, isEuVatId } from '@/lib/tax-registry';
export type RegistryScope = { ownerId: string; signal: AbortSignal };
export class RegistryLookupError extends Error {
 constructor(readonly reason: 'invalid' | 'not-found' | 'unavailable' = 'unavailable') { super('Registry lookup unavailable'); }
}

/** Both registry readers share a captured owner/lifetime and a strict bounded
 * receipt. No raw API/producer error or assumed fallback timestamp is accepted. */
function lookup(scope: RegistryScope, kind: 'ares', value: string): Promise<z.infer<typeof AresLookupSchema>>;
function lookup(scope: RegistryScope, kind: 'vies', value: string): Promise<z.infer<typeof ViesLookupSchema>>;
async function lookup(scope: RegistryScope, kind: 'ares' | 'vies', value: string) {
 const signal = AbortSignal.any([scope.signal, AbortSignal.timeout(28_000)]);
 try {
  signal.throwIfAborted(); z.uuid().parse(scope.ownerId);
  const canonical = kind === 'ares' ? normalizeIco(value) : normalizeVatId(value);
  if (kind === 'ares' ? !isValidIco(canonical) : !isEuVatId(canonical)) throw new RegistryLookupError('invalid');
  const pending = fetch(`/api/registry/${kind}`, { method: 'POST', redirect: 'error', cache: 'no-store', signal,
   headers: { 'Content-Type': 'application/json', 'x-own-dashboard-owner': scope.ownerId }, body: JSON.stringify(kind === 'ares' ? { ico: canonical } : { vatId: canonical }),
  });
  void pending.then(response => { if (signal.aborted && response.body && !response.body.locked) void response.body.cancel().catch(() => undefined); }, () => undefined);
  const response = await awaitWithSignal(pending, signal);
  if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new RegistryLookupError(response.status === 400 ? 'invalid' : kind === 'ares' && response.status === 404 ? 'not-found' : 'unavailable'); }
  const raw: unknown = JSON.parse(await boundedResponseText(response, 32 * 1024, signal));
  const result = kind === 'ares' ? AresLookupSchema.parse(raw) : ViesLookupSchema.parse(raw);
  if (result.ownerId !== scope.ownerId || ('ico' in result ? result.ico : result.vatId) !== canonical) throw new RegistryLookupError();
  signal.throwIfAborted(); return result;
 } catch (error) {
  if (scope.signal.aborted) throw new DOMException('Request aborted', 'AbortError');
  throw error instanceof RegistryLookupError ? error : new RegistryLookupError();
 }
}
export function lookupAres(scope: RegistryScope, ico: string) { return lookup(scope, 'ares', ico); }
export function lookupVies(scope: RegistryScope, vatId: string) { return lookup(scope, 'vies', vatId); }
