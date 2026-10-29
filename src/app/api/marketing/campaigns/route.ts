import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import { readVerifiedServerContext } from '@/lib/supabase/server-owner';
import { rejectCrossOrigin } from '@/lib/csrf';
import { readKnowledgeBody } from '@/lib/marketing/knowledge-body';
import { CampaignActivationInputSchema as Input } from '@/lib/marketing/campaign-activation';

export const maxDuration = 30;
const reply = (body: object, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function POST(request: Request) {
 const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
 const retirement = new AbortController();
 const signal = AbortSignal.any([request.signal, retirement.signal, AbortSignal.timeout(30_000)]);
 let writing = false;
 try {
  signal.throwIfAborted();
  const expectedOwner = request.headers.get('x-own-dashboard-owner');
  if (expectedOwner !== null && !z.uuid().safeParse(expectedOwner).success) return reply({ error: 'invalid-campaign-owner' }, 400);
  const context = await readVerifiedServerContext(signal);
  if (!context) return reply({ error: 'unauthorized' }, 401);
  signal.throwIfAborted();
  if (expectedOwner !== null && expectedOwner !== context.ownerId) return reply({ error: 'campaign-owner-changed' }, 409);
  let input: z.infer<typeof Input>;
  try { input = Input.parse(JSON.parse(await readKnowledgeBody(request, 4096, signal))); }
  catch (error) {
   if (signal.aborted) throw error;
   const status = error instanceof Error && error.message === 'capture-too-large' ? 413 : error instanceof Error && error.name === 'AbortError' ? 408 : 400;
   return reply({ error: 'invalid-campaign' }, status);
  }
  const writeSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  writeSignal.throwIfAborted(); writing = true;
  const result = await awaitWithSignal(context.db.rpc('marketing_activate_campaign', { p_campaign: input.id, p_hash: input.expectedHash }).retry(false).abortSignal(writeSignal), writeSignal);
  signal.throwIfAborted();
  if (result.error?.code === 'P0001') return reply({ error: 'campaign-unavailable' }, 409);
  if (result.error || result.data !== null) throw new Error('activation-unconfirmed');
  return reply({ ownerId: context.ownerId, campaignId: input.id, sourceHash: input.expectedHash, status: 'active' });
 } catch {
  return reply({ error: writing ? 'campaign-unconfirmed' : 'campaign-unavailable' }, 503);
 } finally {
  retirement.abort();
  if (request.body && !request.body.locked && !request.bodyUsed) void request.body.cancel().catch(() => undefined);
 }
}
