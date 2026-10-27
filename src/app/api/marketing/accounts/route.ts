import { z } from 'zod';
import { readVerifiedServerContext } from '@/lib/supabase/server-owner';
import { awaitWithSignal } from '@/lib/abortable';
import { databaseTimestamp } from '@/lib/database-version';
import { MarketingAccountStatusSchema, MarketingAccountsResponseSchema } from '@/lib/marketing/accounts-client';
import { dneskaiCommentWebhookConfigured, dneskaiEngagementWatchEnabled } from '@/lib/marketing/dneskai-engagement';

/**
 * GET /api/marketing/accounts: the owner's connected marketing accounts with
 * non-secret token metadata (expiry, last refresh, scopes). Reads run through
 * the owner's session, so RLS and marketing_account_token_status() keep them
 * own-only; the token value is not readable from this role at all.
 */
export const runtime = 'nodejs';
const AccountRow = z.strictObject({
  id:z.uuid(),user_id:z.uuid(),brand:MarketingAccountStatusSchema.shape.brand,platform:MarketingAccountStatusSchema.shape.platform,
  updated_at:databaseTimestamp,handle:MarketingAccountStatusSchema.shape.handle,verified_at:databaseTimestamp.nullable(),enabled:z.boolean(),
  engagement_enabled:z.boolean().optional(),engagement_blocked_code:z.string().regex(/^[a-z0-9-]{1,100}$/).nullable().optional(),
  engagement_blocked_at:databaseTimestamp.nullable().optional(),
});
const TokenRow = z.strictObject({
  account_id:z.uuid(),brand:MarketingAccountStatusSchema.shape.brand,platform:MarketingAccountStatusSchema.shape.platform,
  expires_at:databaseTimestamp,refreshed_at:databaseTimestamp,
  scopes:z.array(z.string().min(1).max(64)).max(20).refine(values=>new Set(values).size===values.length),
  login_mode:z.enum(['instagram','facebook','threads']),
});
export async function GET(request: Request) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15000)]);
  let context: Awaited<ReturnType<typeof readVerifiedServerContext>>;
  try { context = await readVerifiedServerContext(signal); }
  catch { return Response.json({error:'accounts-unavailable'},{status:503}); }
  if (!context) return Response.json({error:'unauthorized'},{status:401});
  const {db,ownerId} = context;
  // #160: the comment-reply columns exist once 20261023120000 is applied, which DNESKAI_ENGAGEMENT_ENABLED waits for.
  const engagement = dneskaiEngagementWatchEnabled(process.env);
  const result = await awaitWithSignal(db.rpc('read_owned_marketing_accounts',{p_owner:ownerId}).retry(false).abortSignal(signal),signal).catch(()=>null);
  const snapshot = z.strictObject({ownerId:z.literal(ownerId),accounts:z.unknown(),tokens:z.unknown()}).safeParse(result?.data);
  if (!result || result.error || !snapshot.success || signal.aborted) return Response.json({error:'accounts-unavailable'},{status:503});
  const checkedAccounts = z.array(AccountRow.extend({user_id:z.literal(ownerId)})).max(4).safeParse(snapshot.data.accounts);
  const tokenRows = z.array(TokenRow).max(4).safeParse(snapshot.data.tokens);
  if (!checkedAccounts.success || !tokenRows.success)
    return Response.json({error:'accounts-unavailable'},{status:503});
  // The database permits two brands × two platforms, with one account per tuple and one token per account.
  const rows = checkedAccounts.data, byId = new Map(rows.map(row=>[row.id,row]));
  if (byId.size !== rows.length || new Set(rows.map(row=>`${row.brand}/${row.platform}`)).size !== rows.length)
    return Response.json({error:'accounts-unavailable'},{status:503});
  const byAccount = new Map<string,z.infer<typeof TokenRow>>();
  for (const token of tokenRows.data) {
    const account = byId.get(token.account_id);
    if (!account || byAccount.has(token.account_id) || token.brand !== account.brand || token.platform !== account.platform
      || (account.platform === 'threads' ? token.login_mode !== 'threads' : token.login_mode === 'threads'))
      return Response.json({error:'accounts-unavailable'},{status:503});
    byAccount.set(token.account_id,token);
  }
  const parsed = MarketingAccountsResponseSchema.safeParse({ accounts: rows.map(row => {
    const token = byAccount.get(row.id);
    return { id: row.id, brand: row.brand, platform: row.platform, handle: row.handle, verifiedAt: row.verified_at, enabled: row.enabled, updatedAt:row.updated_at,
      token: token ? { expiresAt: token.expires_at, refreshedAt: token.refreshed_at, scopes: token.scopes, loginMode: token.login_mode } : null,
      ...(engagement ? { engagement: { enabled: row.engagement_enabled, blockedCode: row.engagement_blocked_code, blockedAt: row.engagement_blocked_at, webhook: dneskaiCommentWebhookConfigured(process.env) } } : {}) };
  }) });
  if (!parsed.success) return Response.json({ error: 'accounts-unavailable' }, { status: 503 });
  return Response.json(parsed.data, { headers: { 'Cache-Control': 'private, no-store' } });
}
