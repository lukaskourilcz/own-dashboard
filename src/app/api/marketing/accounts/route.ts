import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { MarketingAccountsResponseSchema } from '@/lib/marketing/accounts-client';

/**
 * GET /api/marketing/accounts: the owner's connected marketing accounts with
 * non-secret token metadata (expiry, last refresh, scopes). Reads run through
 * the owner's session, so RLS and marketing_account_token_status() keep them
 * own-only; the token value is not readable from this role at all.
 */
export const runtime = 'nodejs';
const TokenRow = z.object({ account_id: z.uuid(), expires_at: z.string(), refreshed_at: z.string(), scopes: z.array(z.string()), login_mode: z.enum(['instagram', 'facebook', 'threads']) });
export async function GET() {
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const [accounts, tokens] = await Promise.all([
    db.from('marketing_accounts').select('id,user_id,brand,platform,handle,verified_at,enabled').eq('user_id', user.id).order('brand').limit(4),
    db.rpc('marketing_account_token_status'),
  ]);
  const tokenRows = z.array(TokenRow).max(20).safeParse(tokens.data ?? []);
  if (accounts.error || tokens.error || !tokenRows.success) return Response.json({ error: 'accounts-unavailable' }, { status: 503 });
  const parsed = MarketingAccountsResponseSchema.safeParse({ accounts: (accounts.data ?? []).filter(row => row.user_id === user.id).map(row => {
    const token = tokenRows.data.find(item => item.account_id === row.id);
    return { id: row.id, brand: row.brand, platform: row.platform, handle: row.handle, verifiedAt: row.verified_at, enabled: row.enabled,
      token: token ? { expiresAt: token.expires_at, refreshedAt: token.refreshed_at, scopes: token.scopes, loginMode: token.login_mode } : null };
  }) });
  if (!parsed.success) return Response.json({ error: 'accounts-unavailable' }, { status: 503 });
  return Response.json(parsed.data, { headers: { 'Cache-Control': 'private, no-store' } });
}
