import {MarketingAccountControlSchema} from '@/lib/marketing/account-control-contracts';
import {applyMarketingAccountControl} from '@/lib/marketing/account-control-server';
import type {z} from 'zod';
import { readVerifiedServerOwner } from '@/lib/supabase/server-owner';
import { awaitWithSignal } from '@/lib/abortable';
import { boundedRequestText, MarketingRequestBodyError } from '@/lib/marketing/http';
import { createAdminClient } from '@/lib/supabase/admin';
import { rejectCrossOrigin } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { dneskaiEngagementWatchEnabled } from '@/lib/marketing/dneskai-engagement';

/**
 * POST /api/marketing/accounts/engagement (#160): the marketing owner turns replies to keyword comments on or off for
 * the DNESKAi Instagram account. Turning them on needs a verified account and a stored token that grants the comment
 * scope, and clears an earlier block (for example messaging switched off). Answers 404 until DNESKAI_ENGAGEMENT_ENABLED.
 */
export const runtime = 'nodejs';
const Input = MarketingAccountControlSchema;
export async function POST(request: Request) {
  if (!dneskaiEngagementWatchEnabled(process.env)) return Response.json({ error: 'engagement-unavailable' }, { status: 404 });
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30000)]);
  let ownerId: string | null;
  try { ownerId = await readVerifiedServerOwner(signal); }
  catch { return Response.json({error:'account-store-failed'},{status:503}); }
  if (!ownerId) return Response.json({error:'unauthorized'},{status:401});
  let limited: Awaited<ReturnType<typeof rateLimit>>;
  try { limited = await awaitWithSignal(rateLimit(ownerId, { key: 'marketing-account-engagement', limit: 10, windowSec: 600 }),signal); signal.throwIfAborted(); }
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
    const receipt=await applyMarketingAccountControl(createAdminClient(signal),ownerId,input,'engagement',signal);
    return Response.json({receipt},{headers:{'Cache-Control':'private, no-store'}});
  }catch{return Response.json({error:'account-store-failed'},{status:503});}
}
