import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rejectCrossOrigin } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { dneskaiCommentWebhookConfigured } from '@/lib/marketing/dneskai-engagement';
import { EngagementGraphError } from '@/lib/marketing/dneskai-engagement-watch';
import { instagramCommentSubscription } from '@/lib/marketing/dneskai-engagement-ports';

/**
 * POST /api/marketing/accounts/webhook (#161): the marketing owner reads whether Meta sends the DNESKAi account's
 * comments to the app's webhook (`status`) or asks Meta to (`subscribe`, field `comments`). One Graph call, no cost.
 * Answers 404 until the webhook is configured (DNESKAI_ENGAGEMENT_ENABLED and both Meta values).
 */
export const runtime = 'nodejs';
const Input = z.strictObject({ accountId: z.uuid(), action: z.enum(['status', 'subscribe']) });
export async function POST(request: Request) {
  if (!dneskaiCommentWebhookConfigured(process.env)) return Response.json({ error: 'webhook-unavailable' }, { status: 404 });
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const session = await createClient(); const { data: { user } } = await session.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const limited = await rateLimit(user.id, { key: 'marketing-account-webhook', limit: 20, windowSec: 600 });
  if (!limited.ok) return Response.json({ error: 'rate-limited' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfter) } });
  if (!process.env.MARKETING_OWNER_ID || process.env.MARKETING_OWNER_ID !== user.id) return Response.json({ error: 'marketing-owner-required' }, { status: 403 });
  let input: z.infer<typeof Input>;
  try { const raw = await request.text(); if (raw.length > 1000) throw new Error('too-large'); input = Input.parse(JSON.parse(raw)); }
  catch { return Response.json({ error: 'invalid-request' }, { status: 400 }); }
  const db = createAdminClient();
  const { data: account, error } = await db.from('marketing_accounts').select('id,brand,platform,remote_account_id').eq('id', input.accountId).eq('user_id', user.id).maybeSingle();
  if (error) return Response.json({ error: 'account-store-failed' }, { status: 503 });
  if (!account || account.brand !== 'dneskai' || account.platform !== 'instagram') return Response.json({ error: 'account-unavailable' }, { status: 404 });
  try {
    const result = await instagramCommentSubscription(db, user.id, { id: account.id, remoteAccountId: account.remote_account_id }, input.action, process.env);
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (failure) {
    const code = failure instanceof EngagementGraphError ? failure.code : 'meta-request-failed';
    return Response.json({ error: code }, { status: failure instanceof EngagementGraphError && failure.kind === 'uncertain' ? 502 : 409 });
  }
}
