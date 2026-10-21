import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rejectCrossOrigin } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { listMetaTokenMetadata, MetaCredentialError } from '@/lib/marketing/meta-credentials';
import { MarketingAccountStatusSchema } from '@/lib/marketing/accounts-client';

/**
 * POST /api/marketing/accounts/enable: the marketing owner turns publishing on or off for one verified account.
 * Turning it on needs a verified account and a stored, unexpired token; turning it off always works. This is the
 * account switch the publisher and the scheduler read; the deployment switches (MARKETING_PUBLISH_ENABLED and
 * MARKETING_<BRAND>_PUBLISH_ENABLED) and per-post approval still apply on top of it.
 */
export const runtime = 'nodejs';
const Input = z.strictObject({ accountId: z.uuid(), enabled: z.boolean() });
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const session = await createClient(); const { data: { user } } = await session.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const limited = await rateLimit(user.id, { key: 'marketing-account-enable', limit: 10, windowSec: 600 });
  if (!limited.ok) return Response.json({ error: 'rate-limited' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfter) } });
  if (!process.env.MARKETING_OWNER_ID || process.env.MARKETING_OWNER_ID !== user.id) return Response.json({ error: 'marketing-owner-required' }, { status: 403 });
  let input: z.infer<typeof Input>;
  try { const raw = await request.text(); if (raw.length > 1000) throw new Error('too-large'); input = Input.parse(JSON.parse(raw)); }
  catch { return Response.json({ error: 'invalid-request' }, { status: 400 }); }
  const db = createAdminClient();
  try {
    const { data: account, error } = await db.from('marketing_accounts').select('id,user_id,brand,platform,handle,verified_at,enabled').eq('id', input.accountId).eq('user_id', user.id).maybeSingle();
    if (error) return Response.json({ error: 'account-store-failed' }, { status: 503 });
    if (!account) return Response.json({ error: 'account-unavailable' }, { status: 404 });
    let token: z.infer<typeof MarketingAccountStatusSchema>['token'] = null;
    try {
      const meta = (await listMetaTokenMetadata(db, user.id)).find(row => row.accountId === account.id);
      if (meta) token = { expiresAt: meta.expiresAt, refreshedAt: meta.refreshedAt, scopes: meta.scopes, loginMode: meta.loginMode };
    } catch (failure) {
      if (!(failure instanceof MetaCredentialError) || input.enabled) return Response.json({ error: 'credential-store-unavailable' }, { status: 503 });
    }
    if (input.enabled) {
      if (!account.verified_at) return Response.json({ error: 'account-not-verified' }, { status: 409 });
      if (!token) return Response.json({ error: 'access-token-missing' }, { status: 409 });
      if (!(Date.parse(token.expiresAt) > Date.now())) return Response.json({ error: 'access-token-expired' }, { status: 409 });
    }
    const updated = await db.from('marketing_accounts').update({ enabled: input.enabled }).eq('id', account.id).eq('user_id', user.id).select('id,brand,platform,handle,verified_at,enabled').single();
    if (updated.error || !updated.data) return Response.json({ error: 'account-store-failed' }, { status: 503 });
    const body = MarketingAccountStatusSchema.parse({ id: updated.data.id, brand: updated.data.brand, platform: updated.data.platform, handle: updated.data.handle,
      verifiedAt: updated.data.verified_at, enabled: updated.data.enabled, token });
    return Response.json({ account: body }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'account-store-failed' }, { status: 503 });
  }
}
