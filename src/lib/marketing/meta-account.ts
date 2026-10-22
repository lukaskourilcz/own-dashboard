import 'server-only';
import { z } from 'zod';
import type { createAdminClient } from '@/lib/supabase/admin';
import { bootstrapMetaCredential, FACEBOOK_LOGIN_SCOPES, INSTAGRAM_LOGIN_SCOPES, metaScopesStorable, readStoredMetaToken, type BootstrapMetaCredential, type StoredMetaToken } from './meta-credentials';

/**
 * Owner-triggered verification of the DNESKAi Instagram account (#121).
 *
 * Reads the professional account through Instagram Login
 * (`GET graph.instagram.com/<version>/me`) with whichever valid token expires
 * later: the stored one (after a refresh) or the environment bootstrap (after
 * the owner installs a new token). It then records the account row (always
 * disabled for publishing on first verification) and that token in one
 * transaction. Granted scopes of a bootstrap token come from
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
  tokenStored: boolean; token: { expiresAt: string; refreshedAt: string; scopes: string[]; loginMode: 'instagram' | 'facebook' };
  /** Facebook Login only (#166): the Page @dneskai is linked to. Not stored; shown after verification. */
  page?: { id: string; name: string } };
/** A Facebook Page with its linked Instagram professional account, from `/me/accounts` or, for a Page token, `/me`. */
const PageSchema = z.object({ id: z.string().regex(/^\d{1,100}$/), name: z.string().max(200),
  instagram_business_account: z.object({ id: z.string().regex(/^\d{1,100}$/), username: z.string().regex(/^[A-Za-z0-9._]{1,30}$/) }).optional() });

type VerificationCredential = { source: 'database' | 'environment'; accessToken: string; expiresAt: number; scopes: string[] };
const tokenShape = /^\S{20,4096}$/;
/** The live Instagram Login token that expires later; the stored one wins a tie. */
export function verificationCredential(stored: StoredMetaToken | null, bootstrap: BootstrapMetaCredential, now: Date, mode: 'instagram' | 'facebook' = 'instagram'): VerificationCredential | { hold: string } {
  const live = (value: string) => Number.isFinite(Date.parse(value)) && Date.parse(value) > now.getTime();
  const fromStore = stored && stored.loginMode === mode && live(stored.expiresAt)
    ? { source: 'database' as const, accessToken: stored.accessToken, expiresAt: Date.parse(stored.expiresAt), scopes: stored.scopes } : null;
  const fromEnvironment = tokenShape.test(bootstrap.accessToken) && live(bootstrap.expiresAt)
    ? { source: 'environment' as const, accessToken: bootstrap.accessToken, expiresAt: Date.parse(bootstrap.expiresAt), scopes: bootstrap.scopes } : null;
  if (fromStore && fromEnvironment) return fromEnvironment.expiresAt > fromStore.expiresAt ? fromEnvironment : fromStore;
  const chosen = fromStore ?? fromEnvironment;
  if (chosen) return chosen;
  if (!tokenShape.test(bootstrap.accessToken)) return { hold: stored ? 'access-token-expired' : 'access-token-missing' };
  return { hold: Number.isFinite(Date.parse(bootstrap.expiresAt)) ? 'access-token-expired' : 'access-token-expiry-unverified' };
}
async function storedInstagramToken(db: Database, ownerId: string, brand: VerifiableBrand): Promise<StoredMetaToken | null> {
  let found: { data: { id: string } | null; error: unknown };
  try { found = await db.from('marketing_accounts').select('id').eq('user_id', ownerId).eq('brand', brand).eq('platform', 'instagram').maybeSingle(); }
  catch { return fail('credential-store-unavailable', 503); }
  if (found.error) return fail('credential-store-unavailable', 503);
  if (!found.data) return null;
  // A store error is never treated as "no stored token".
  try { return await readStoredMetaToken(db, ownerId, found.data.id); }
  catch { return fail('credential-store-unavailable', 503); }
}

export function expectedInstagramHandle(brand: VerifiableBrand, env: Environment = process.env): string {
  return (env[`MARKETING_${brand.toUpperCase()}_INSTAGRAM_HANDLE`] ?? DEFAULT_HANDLES[brand]).replace(/^@/, '').toLowerCase();
}

export async function verifyInstagramAccount(db: Database, ownerId: string, brand: VerifiableBrand,
  options: { env?: Environment; fetcher?: typeof fetch; now?: Date; signal?: AbortSignal } = {}): Promise<VerifiedMarketingAccount> {
  const env = options.env ?? process.env; const now = options.now ?? new Date();
  if (!z.uuid().safeParse(ownerId).success || env.MARKETING_OWNER_ID !== ownerId) fail('marketing-owner-required', 403);
  const prefix = `MARKETING_${brand.toUpperCase()}_INSTAGRAM`;
  const bootstrap = bootstrapMetaCredential(brand, 'instagram', env);
  // #166: `MARKETING_DNESKAI_INSTAGRAM_LOGIN_MODE` picks Instagram Login (default today) or Facebook Login for Business.
  const mode = bootstrap.loginMode;
  if (mode !== 'instagram' && mode !== 'facebook') return fail('instagram-login-required');
  const version = env[`${prefix}_API_VERSION`] ?? '';
  if (!/^v\d+\.\d+$/.test(version)) fail('api-version-unverified');
  const credential = verificationCredential(await storedInstagramToken(db, ownerId, brand), bootstrap, now, mode);
  if ('hold' in credential) return fail(credential.hold);
  if ((mode === 'facebook' ? FACEBOOK_LOGIN_SCOPES : INSTAGRAM_LOGIN_SCOPES).some(scope => !credential.scopes.includes(scope))) fail('publishing-scopes-unverified');
  // The store refuses more than 20 scopes or a malformed one; refuse here first so nothing is sent or written.
  if (!metaScopesStorable(credential.scopes)) fail('verified-scopes-invalid');

  const get = async (url: URL): Promise<unknown> => {
    const timeout = AbortSignal.timeout(10000);
    let response: Response;
    try { response = await (options.fetcher ?? fetch)(url.href, { method: 'GET', redirect: 'error', cache: 'no-store', headers: { Authorization: `Bearer ${credential.accessToken}` },
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout }); }
    catch { return fail('meta-request-failed', 502); }
    if (!response.ok) return fail(`meta-http-${response.status}`, 502);
    try { return await response.json(); } catch { return fail('meta-invalid-response', 502); }
  };
  let profile: z.infer<typeof ProfileSchema>;
  let page: { id: string; name: string } | undefined;
  let accountType: string;
  if (mode === 'facebook') {
    // A user token lists its Pages; a Page token is the Page itself. Either way the linked Instagram account is
    // `instagram_business_account`, which exists only for a professional account.
    const fields = 'id,name,instagram_business_account{id,username}';
    const accounts = new URL(`https://graph.facebook.com/${version}/me/accounts`);
    accounts.searchParams.set('fields', fields); accounts.searchParams.set('limit', '25');
    let pages: z.infer<typeof PageSchema>[];
    try {
      const listed = z.object({ data: z.array(PageSchema).max(25) }).safeParse(await get(accounts));
      if (listed.success) pages = listed.data.data;
      else {
        const me = new URL(`https://graph.facebook.com/${version}/me`); me.searchParams.set('fields', fields);
        const single = PageSchema.safeParse(await get(me));
        if (!single.success) return fail('meta-invalid-response', 502);
        pages = [single.data];
      }
    } catch (error) {
      if (!(error instanceof MarketingAccountVerificationError) || !/^meta-http-4\d\d$/.test(error.code)) throw error;
      // A Page token cannot list Pages; read the Page itself.
      const me = new URL(`https://graph.facebook.com/${version}/me`); me.searchParams.set('fields', fields);
      const single = PageSchema.safeParse(await get(me));
      if (!single.success) return fail('meta-invalid-response', 502);
      pages = [single.data];
    }
    const handle = expectedInstagramHandle(brand, env);
    const linked = pages.find(item => item.instagram_business_account?.username.toLowerCase() === handle);
    if (!linked) return fail(pages.some(item => item.instagram_business_account) ? 'remote-account-handle-mismatch' : 'facebook-page-link-required');
    profile = { user_id: linked.instagram_business_account!.id, username: linked.instagram_business_account!.username, account_type: 'PAGE_LINKED' };
    page = { id: linked.id, name: linked.name };
    accountType = 'PAGE_LINKED';
  } else {
    const url = new URL(`https://graph.instagram.com/${version}/me`);
    url.searchParams.set('fields', 'user_id,username,account_type');
    const parsed = ProfileSchema.safeParse(await get(url));
    if (!parsed.success) return fail('meta-invalid-response', 502);
    profile = parsed.data;
    accountType = profile.account_type.toUpperCase();
    if (!(INSTAGRAM_PROFESSIONAL_ACCOUNT_TYPES as readonly string[]).includes(accountType)) fail('professional-account-required');
    if (profile.username.toLowerCase() !== expectedInstagramHandle(brand, env)) fail('remote-account-handle-mismatch');
  }

  let stored: { data: unknown; error: unknown };
  try {
    stored = await db.rpc('marketing_verify_account', { p_owner: ownerId, p_brand: brand, p_platform: 'instagram', p_remote_account_id: profile.user_id, p_handle: profile.username,
      p_token: credential.accessToken, p_expires_at: new Date(credential.expiresAt).toISOString(), p_scopes: credential.scopes, p_login_mode: mode });
  } catch { return fail('account-store-failed', 503); }
  const row = StoredSchema.safeParse(stored.data);
  if (stored.error || !row.success || row.data.token.loginMode !== mode) return fail('account-store-failed', 503);
  return { accountId: row.data.accountId, brand, platform: 'instagram', handle: row.data.handle, accountType, verifiedAt: row.data.verifiedAt, enabled: row.data.enabled,
    tokenStored: row.data.tokenStored, token: { ...row.data.token, loginMode: mode }, ...(page ? { page } : {}) };
}
