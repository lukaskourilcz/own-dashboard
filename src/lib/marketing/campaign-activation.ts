import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import { boundedResponseText } from '@/lib/bounded-response';

export const CampaignActivationInputSchema = z.strictObject({ id: z.uuid(), expectedHash: z.string().regex(/^[a-f0-9]{64}$/) });
export const CampaignActivationReceiptSchema = z.strictObject({ ownerId: z.uuid(), campaignId: z.uuid(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), status: z.literal('active') });
export type CampaignActivationScope = { ownerId: string; signal: AbortSignal };
export class CampaignActivationError extends Error {
 constructor(readonly reason: 'changed' | 'unavailable' | 'unconfirmed') { super('Campaign activation unavailable'); }
}
/** One captured attempt. An unknown admitted result is never replayed. */
export async function activateMarketingCampaign(scope: CampaignActivationScope, input: z.infer<typeof CampaignActivationInputSchema>) {
 const retirement = new AbortController(), signal = AbortSignal.any([scope.signal, retirement.signal, AbortSignal.timeout(35_000)]);
 const discard = (response: Response) => { if (response.body && !response.body.locked) void response.body.cancel().catch(() => undefined); };
 let response: Response | undefined, admitted = false;
 try {
  signal.throwIfAborted(); z.uuid().parse(scope.ownerId); const intent = CampaignActivationInputSchema.parse(input);
  await Promise.resolve(); signal.throwIfAborted(); admitted = true;
  const pending = fetch('/api/marketing/campaigns', { method: 'POST', cache: 'no-store', redirect: 'error', signal, headers: { 'Content-Type': 'application/json', 'x-own-dashboard-owner': scope.ownerId }, body: JSON.stringify(intent) });
  void pending.then(value => { if (signal.aborted) discard(value); }, () => undefined);
  response = await awaitWithSignal(pending, signal); signal.throwIfAborted();
  if (response.redirected || response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new Error();
  const value: unknown = JSON.parse(await boundedResponseText(response, response.status === 200 ? 1024 : 4096, signal));
  if (response.status !== 200) {
   const refusal = z.strictObject({ error: z.string() }).safeParse(value);
   if (response.status === 409 && refusal.success && ['campaign-owner-changed', 'campaign-unavailable'].includes(refusal.data.error)) throw new CampaignActivationError('changed');
   throw new Error();
  }
  const receipt = CampaignActivationReceiptSchema.parse(value);
  if (receipt.ownerId !== scope.ownerId || receipt.campaignId !== intent.id || receipt.sourceHash !== intent.expectedHash) throw new Error();
  signal.throwIfAborted(); return receipt;
 } catch (error) {
  if (scope.signal.aborted) throw new DOMException('Request aborted', 'AbortError');
  throw error instanceof CampaignActivationError ? error : new CampaignActivationError(admitted ? 'unconfirmed' : 'unavailable');
 } finally { retirement.abort(); if (response) discard(response); }
}
