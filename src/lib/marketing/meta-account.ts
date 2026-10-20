import 'server-only';
import { z } from 'zod';
import type { createAdminClient } from '@/lib/supabase/admin';
import { bootstrapMetaCredential, INSTAGRAM_LOGIN_SCOPES, metaScopesStorable } from './meta-credentials';

/**
 * Owner-triggered verification of the DNESKAi Instagram account (#121).
 *
 * Reads the professional account behind the bootstrap token through
 * Instagram Login (`GET graph.instagram.com/<version>/me`), then records the
 * account row (always disabled for publishing on first verification) and the
 * token row in one transaction. Granted scopes come from
 * `MARKETING_<BRAND>_INSTAGRAM_VERIFIED_SCOPES`: Instagram Login has no API
 * that lists a token's permissions (Meta's debug_token belongs to Facebook
 * Login and needs an app token), so the owner copies them from Meta's Access
 * Token Debugger.
 */
type Database = ReturnType<typeof createAdminClient>;
type Environment = Record<string, string | undefined>;
export type VerifiableBrand = 'dneskai';
/** Professional account types returned by Instagram Login; a personal account cannot publish. */
export const INSTAGRAM_PROFESSIONAL_ACCOUNT_TYPES = ['BUSINESS', 'MEDIA_CREATOR'] as const;
const DEFAULT_HANDLES: Record<VerifiableBrand, string> = { dneskai: 'dneskai' };

export class MarketingAccountVerificationError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); this.name = 'MarketingAccountVerificationError'; }
}
const fail = (code: string, status = 409): never => { throw new MarketingAccountVerificationError(code, status); };

const ProfileSchema = z.object({ user_id: z.string().regex(/^\d{1,100}$/), username: z.string().regex(/^[A-Za-z0-9._]{1,30}$/), account_type: z.string().max(40) });
const StoredSchema = z.object({ accountId: z.uuid(), remoteAccountId: z.string(), handle: z.string(), verifiedAt: z.string(), enabled: z.boolean(), tokenStored: z.boolean(),
  token: z.object({ expiresAt: z.string(), refreshedAt: z.string(), scopes: z.array(z.string()).max(20), loginMode: z.enum(['instagram', 'facebook', 'threads']) }) });
export type VerifiedMarketingAccount = { accountId: string; brand: VerifiableBrand; platform: 'instagram'; handle: string; accountType: string; verifiedAt: string; enabled: boolean;
  tokenStored: boolean; token: { expiresAt: string; refreshedAt: string; scopes: string[]; loginMode: 'instagram' } };

export function expectedInstagramHandle(brand: VerifiableBrand, env: Environment = process.env): string {
  return (env[`MARKETING_${brand.toUpperCase()}_INSTAGRAM_HANDLE`] ?? DEFAULT_HANDLES[brand]).replace(/^@/, '').toLowerCase();
}

export async function verifyInstagramAccount(db: Database, ownerId: string, brand: VerifiableBrand,
  options: { env?: Environment; fetcher?: typeof fetch; now?: Date; signal?: AbortSignal } = {}): Promise<VerifiedMarketingAccount> {
  const env = options.env ?? process.env; const now = options.now ?? new Date();
  if (!z.uuid().safeParse(ownerId).success || env.MARKETING_OWNER_ID !== ownerId) fail('marketing-owner-required', 403);
  const prefix = `MARKETING_${brand.toUpperCase()}_INSTAGRAM`;
  const bootstrap = bootstrapMetaCredential(brand, 'instagram', env);
  if (bootstrap.loginMode !== 'instagram') fail('instagram-login-required');
  const version = env[`${prefix}_API_VERSION`] ?? '';
  if (!/^v\d+\.\d+$/.test(version)) fail('api-version-unverified');
  if (!/^\S{20,4096}$/.test(bootstrap.accessToken)) fail('access-token-missing');
  const expires = Date.parse(bootstrap.expiresAt);
  if (!Number.isFinite(expires)) fail('access-token-expiry-unverified');
  if (expires <= now.getTime()) fail('access-token-expired');
  if (INSTAGRAM_LOGIN_SCOPES.some(scope => !bootstrap.scopes.includes(scope))) fail('publishing-scopes-unverified');
  // The store refuses more than 20 scopes or a malformed one; refuse here first so nothing is sent or written.
  if (!metaScopesStorable(bootstrap.scopes)) fail('verified-scopes-invalid');

  const url = new URL(`https://graph.instagram.com/${version}/me`);
  url.searchParams.set('fields', 'user_id,username,account_type');
  const timeout = AbortSignal.timeout(10000);
  let response: Response;
  try { response = await (options.fetcher ?? fetch)(url.href, { method: 'GET', redirect: 'error', cache: 'no-store', headers: { Authorization: `Bearer ${bootstrap.accessToken}` },
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout }); }
  catch { return fail('meta-request-failed', 502); }
  if (!response.ok) fail(`meta-http-${response.status}`, 502);
  let profile: z.infer<typeof ProfileSchema>;
  try {
    const parsed = ProfileSchema.safeParse(await response.json());
    if (!parsed.success) return fail('meta-invalid-response', 502);
    profile = parsed.data;
  } catch (error) { if (error instanceof MarketingAccountVerificationError) throw error; return fail('meta-invalid-response', 502); }
  const accountType = profile.account_type.toUpperCase();
  if (!(INSTAGRAM_PROFESSIONAL_ACCOUNT_TYPES as readonly string[]).includes(accountType)) fail('professional-account-required');
  if (profile.username.toLowerCase() !== expectedInstagramHandle(brand, env)) fail('remote-account-handle-mismatch');

  let stored: { data: unknown; error: unknown };
  try {
    stored = await db.rpc('marketing_verify_account', { p_owner: ownerId, p_brand: brand, p_platform: 'instagram', p_remote_account_id: profile.user_id, p_handle: profile.username,
      p_token: bootstrap.accessToken, p_expires_at: new Date(expires).toISOString(), p_scopes: bootstrap.scopes, p_login_mode: 'instagram' });
  } catch { return fail('account-store-failed', 503); }
  const row = StoredSchema.safeParse(stored.data);
  if (stored.error || !row.success || row.data.token.loginMode !== 'instagram') return fail('account-store-failed', 503);
  return { accountId: row.data.accountId, brand, platform: 'instagram', handle: row.data.handle, accountType, verifiedAt: row.data.verifiedAt, enabled: row.data.enabled,
    tokenStored: row.data.tokenStored, token: { ...row.data.token, loginMode: 'instagram' } };
}
