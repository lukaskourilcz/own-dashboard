import { z } from 'zod';
import { readVerifiedServerOwner } from '@/lib/supabase/server-owner';
import { awaitWithSignal } from '@/lib/abortable';
import { boundedRequestText, MarketingRequestBodyError } from '@/lib/marketing/http';
import { createAdminClient } from '@/lib/supabase/admin';
import { rejectCrossOrigin } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { dneskaiCommentWebhookConfigured } from '@/lib/marketing/dneskai-engagement';
import { EngagementGraphError } from '@/lib/marketing/dneskai-engagement-watch';
import { instagramCommentSubscription } from '@/lib/marketing/dneskai-engagement-ports';

/**
 * POST /api/marketing/accounts/webhook (#161): the marketing owner reads whether Meta sends the DNESKAi account's
 * comments to the app's webhook (`status`) or asks Meta to (`subscribe`, field `comments`). The original scope
 * covers the owned account read, credentials, linked Page lookup and subscription request.
 * Answers 404 until the webhook is configured (DNESKAI_ENGAGEMENT_ENABLED and both Meta values).
 */
export const runtime = 'nodejs';
export const maxDuration = 30;
const Input = z.strictObject({ accountId: z.uuid(), action: z.enum(['status', 'subscribe']) });
export async function POST(request: Request) {
  if (!dneskaiCommentWebhookConfigured(process.env)) return Response.json({ error: 'webhook-unavailable' }, { status: 404 });
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30000)]);
  let ownerId: string | null;
  try { ownerId = await readVerifiedServerOwner(signal); }
  catch { return Response.json({error:'account-store-failed'},{status:503}); }
  if (!ownerId) return Response.json({error:'unauthorized'},{status:401});
  let limited: Awaited<ReturnType<typeof rateLimit>>;
  try { limited = await awaitWithSignal(rateLimit(ownerId, { key: 'marketing-account-webhook', limit: 20, windowSec: 600 }),signal); signal.throwIfAborted(); }
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
  let db: ReturnType<typeof createAdminClient>;
  let account: { id: string; remote_account_id: string };
  try {
    db = createAdminClient(signal);
    const result = await awaitWithSignal(db.from('marketing_accounts').select('id,user_id,brand,platform,remote_account_id').eq('id', input.accountId).eq('user_id', ownerId).maybeSingle(), signal);
    signal.throwIfAborted();
    if (result.error) return Response.json({ error: 'account-store-failed' }, { status: 503 });
    if (result.data === null) return Response.json({ error: 'account-unavailable' }, { status: 404 });
    const parsed = z.strictObject({ id: z.uuid(), user_id: z.uuid(), brand: z.enum(['dneskai', 'devshark']), platform: z.enum(['instagram', 'threads']), remote_account_id: z.string().regex(/^\d{1,40}$/) }).safeParse(result.data);
    if (!parsed.success || parsed.data.id !== input.accountId || parsed.data.user_id !== ownerId) return Response.json({ error: 'account-store-failed' }, { status: 503 });
    if (parsed.data.brand !== 'dneskai' || parsed.data.platform !== 'instagram') return Response.json({ error: 'account-unavailable' }, { status: 404 });
    account = parsed.data;
  } catch { return Response.json({ error: 'account-store-failed' }, { status: 503 }); }
  try {
    const result = await instagramCommentSubscription(db, ownerId, { id: account.id, remoteAccountId: account.remote_account_id }, input.action, process.env, fetch, signal);
    signal.throwIfAborted();
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (failure) {
    const code = failure instanceof EngagementGraphError ? failure.code : 'meta-request-failed';
    return Response.json({ error: code }, { status: failure instanceof EngagementGraphError && failure.kind === 'uncertain' ? 502 : 409 });
  }
}
