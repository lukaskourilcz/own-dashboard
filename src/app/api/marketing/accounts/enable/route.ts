import {MarketingAccountControlSchema} from '@/lib/marketing/account-control-contracts';
import {applyMarketingAccountControl} from '@/lib/marketing/account-control-server';
import type {z} from 'zod';
import { readVerifiedServerOwner } from '@/lib/supabase/server-owner';
import { awaitWithSignal } from '@/lib/abortable';
import { boundedRequestText, MarketingRequestBodyError } from '@/lib/marketing/http';
import { createAdminClient } from '@/lib/supabase/admin';
import { rejectCrossOrigin } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';

/**
 * POST /api/marketing/accounts/enable: the marketing owner turns publishing on or off for one verified account.
 * Turning it on needs a verified account and a stored, unexpired token; turning it off always works. This is the
 * account switch the publisher and the scheduler read; the deployment switches (MARKETING_PUBLISH_ENABLED and
 * MARKETING_<BRAND>_PUBLISH_ENABLED) and per-post approval still apply on top of it.
 */
export const runtime = 'nodejs';
const Input = MarketingAccountControlSchema;
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30000)]);
  let ownerId: string | null;
  try { ownerId = await readVerifiedServerOwner(signal); }
  catch { return Response.json({error:'account-store-failed'},{status:503}); }
  if (!ownerId) return Response.json({error:'unauthorized'},{status:401});
  let limited: Awaited<ReturnType<typeof rateLimit>>;
  try { limited = await awaitWithSignal(rateLimit(ownerId, { key: 'marketing-account-enable', limit: 10, windowSec: 600 }),signal); signal.throwIfAborted(); }
  catch { return Response.json({error:'account-store-failed'},{status:503}); }
  if (!limited.ok) return Response.json({error:'rate-limited'},{status:429,headers:{'Retry-After':String(limited.retryAfter)}});
  if (!process.env.MARKETING_OWNER_ID || process.env.MARKETING_OWNER_ID !== ownerId) return Response.json({ error: 'marketing-owner-required' }, { status: 403 });
  let input: z.infer<typeof Input>;
  try { input = Input.parse(JSON.parse(await boundedRequestText(request,1000,signal))); }
  catch (error) {
    if (signal.aborted || error instanceof MarketingRequestBodyError && ['request-body-aborted','request-body-timeout'].includes(error.code))
      return Response.json({error:'account-store-failed'},{status:503});
    return Response.json({error:'invalid-request'},{status:400});
  }
  if (signal.aborted) return Response.json({error:'account-store-failed'},{status:503});
  if(input.ownerId!==ownerId)return Response.json({error:'unauthorized'},{status:401});
  try {
    const receipt=await applyMarketingAccountControl(createAdminClient(signal),ownerId,input,'publishing',signal);
    return Response.json({receipt},{headers:{'Cache-Control':'private, no-store'}});
  }catch{return Response.json({error:'account-store-failed'},{status:503});}
}
