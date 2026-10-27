import { z } from 'zod';
import { readVerifiedServerOwner } from '@/lib/supabase/server-owner';
import { awaitWithSignal } from '@/lib/abortable';
import { createAdminClient } from '@/lib/supabase/admin';
import { rejectCrossOrigin } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { listMetaTokenMetadata } from '@/lib/marketing/meta-credentials';
import { MarketingAccountStatusSchema } from '@/lib/marketing/accounts-client';
import { dneskaiEngagementWatchEnabled } from '@/lib/marketing/dneskai-engagement';
import { DNESKAI_ENGAGEMENT_SCOPES } from '@/lib/marketing/dneskai-engagement-ports';

/**
 * POST /api/marketing/accounts/engagement (#160): the marketing owner turns replies to keyword comments on or off for
 * the DNESKAi Instagram account. Turning them on needs a verified account and a stored token that grants the comment
 * scope, and clears an earlier block (for example messaging switched off). Answers 404 until DNESKAI_ENGAGEMENT_ENABLED.
 */
export const runtime = 'nodejs';
const Input = z.strictObject({ accountId: z.uuid(), enabled: z.boolean() });
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
  try { const raw = await request.text(); if (raw.length > 1000) throw new Error('too-large'); input = Input.parse(JSON.parse(raw)); }
  catch { return Response.json({ error: 'invalid-request' }, { status: 400 }); }
  if (signal.aborted) return Response.json({error:'account-store-failed'},{status:503});
  const db = createAdminClient(signal);
  try {
    const { data: account, error } = await db.from('marketing_accounts').select('id,brand,platform,verified_at').eq('id', input.accountId).eq('user_id', ownerId).maybeSingle();
    if (error) return Response.json({ error: 'account-store-failed' }, { status: 503 });
    if (!account || account.brand !== 'dneskai' || account.platform !== 'instagram') return Response.json({ error: 'account-unavailable' }, { status: 404 });
    const meta = (await listMetaTokenMetadata(db, ownerId)).find(row => row.accountId === account.id) ?? null;
    if (input.enabled) {
      if (!account.verified_at) return Response.json({ error: 'account-not-verified' }, { status: 409 });
      if (!meta) return Response.json({ error: 'access-token-missing' }, { status: 409 });
      if (!(Date.parse(meta.expiresAt) > Date.now())) return Response.json({ error: 'access-token-expired' }, { status: 409 });
      if (DNESKAI_ENGAGEMENT_SCOPES.some(scope => !meta.scopes.includes(scope))) return Response.json({ error: 'engagement-scopes-unverified' }, { status: 409 });
    }
    const updated = await db.from('marketing_accounts').update({ engagement_enabled: input.enabled, ...(input.enabled ? { engagement_blocked_code: null, engagement_blocked_at: null } : {}) })
      .eq('id', account.id).eq('user_id', ownerId).select('id,brand,platform,handle,verified_at,enabled,engagement_enabled,engagement_blocked_code,engagement_blocked_at').single();
    if (updated.error || !updated.data) return Response.json({ error: 'account-store-failed' }, { status: 503 });
    const row = updated.data;
    const body = MarketingAccountStatusSchema.parse({ id: row.id, brand: row.brand, platform: row.platform, handle: row.handle, verifiedAt: row.verified_at, enabled: row.enabled,
      token: meta ? { expiresAt: meta.expiresAt, refreshedAt: meta.refreshedAt, scopes: meta.scopes, loginMode: meta.loginMode } : null,
      engagement: { enabled: row.engagement_enabled, blockedCode: row.engagement_blocked_code, blockedAt: row.engagement_blocked_at } });
    return Response.json({ account: body }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'account-store-failed' }, { status: 503 });
  }
}
