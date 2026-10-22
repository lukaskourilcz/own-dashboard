import 'server-only';
import { z } from 'zod';
import type { createAdminClient } from '@/lib/supabase/admin';
import type { MarketingBrand } from './contracts';
import type { MetaPublisherConfig } from './publisher';

/**
 * Meta access-token resolution and refresh (#121).
 *
 * The stored token in `marketing_account_tokens` wins while it is unexpired.
 * `MARKETING_<BRAND>_<PLATFORM>_ACCESS_TOKEN` is only the bootstrap value the
 * owner installs once. Nothing here logs, returns or persists a token outside
 * the service-role functions, and no ambiguous request is retried.
 */
type Database = ReturnType<typeof createAdminClient>;
type Environment = Record<string, string | undefined>;
export type MetaPlatform = 'instagram' | 'threads';
export type MetaLoginMode = MetaPublisherConfig['loginMode'];
export type MetaCredentialAccount = { id: string; user_id: string; brand: MarketingBrand; platform: MetaPlatform };
export type StoredMetaToken = { accessToken: string; expiresAt: string; refreshedAt: string; scopes: string[]; loginMode: MetaLoginMode };
export type MetaTokenMetadata = { accountId: string; brand: MarketingBrand; platform: MetaPlatform; expiresAt: string; refreshedAt: string; scopes: string[]; loginMode: MetaLoginMode };
export type BootstrapMetaCredential = { accessToken: string; expiresAt: string; scopes: string[]; loginMode: MetaLoginMode | null };
export type ChosenMetaCredential =
  | { source: 'database' | 'environment'; accessToken: string; expiresAt: string; scopes: string[]; loginMode: MetaLoginMode; refreshedAt: string | null }
  | { hold: string };
export type InstagramTokenRefreshOutcome =
  | { status: 'refreshed'; accountId: string; expiresAt: string; refreshedAt: string }
  | { status: 'skipped' | 'held' | 'failed' | 'uncertain'; accountId: string; code: string };

export const INSTAGRAM_LOGIN_SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'] as const;
/**
 * Facebook Login for Business (#166): what verification requires before it stores a token. The publisher needs the
 * first three; `pages_show_list` finds the Page linked to @dneskai. Comments and messages
 * (`instagram_manage_comments`, `instagram_manage_messages`) belong to the comment watcher and are not required here.
 */
export const FACEBOOK_LOGIN_SCOPES = ['instagram_basic', 'instagram_content_publish', 'pages_read_engagement', 'pages_show_list'] as const;
/** Facebook Login's long-lived token exchange; it needs the Meta app's id and secret (server-only). */
export const FACEBOOK_TOKEN_ENDPOINT = 'https://graph.facebook.com';
/** Meta refreshes only a long-lived token that is at least 24 hours old and unexpired. */
export const INSTAGRAM_TOKEN_MIN_AGE_MS = 24 * 60 * 60 * 1000;
/** The #120 scheduler refreshes a token once fewer than ten days remain. */
export const INSTAGRAM_TOKEN_REFRESH_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;
/** Long-lived Instagram User tokens last 60 days from issue or refresh. */
export const INSTAGRAM_LONG_LIVED_TOKEN_MS = 60 * 24 * 60 * 60 * 1000;
export const INSTAGRAM_REFRESH_ENDPOINT = 'https://graph.instagram.com/refresh_access_token';

const tokenValue = z.string().regex(/^\S{20,4096}$/);
const loginMode = z.enum(['instagram', 'facebook', 'threads']);
const scope = z.string().regex(/^[a-z_]{1,64}$/);
/** The token store accepts at most 20 scopes of this shape; checked before any write or refresh. */
export const META_SCOPE_LIMIT = 20;
export function metaScopesStorable(scopes: readonly string[]): boolean {
  return scopes.length <= META_SCOPE_LIMIT && scopes.every(value => scope.safeParse(value).success);
}
const StoredRowSchema = z.object({ access_token: tokenValue, expires_at: z.string().min(1), refreshed_at: z.string().min(1), scopes: z.array(scope).max(20), login_mode: loginMode });
const MetadataRowSchema = z.object({ account_id: z.uuid(), brand: z.enum(['dneskai', 'devshark']), platform: z.enum(['instagram', 'threads']), expires_at: z.string().min(1), refreshed_at: z.string().min(1), scopes: z.array(scope).max(20), login_mode: loginMode });
const RefreshResponseSchema = z.object({ access_token: tokenValue, token_type: z.string().max(20).optional(), expires_in: z.number().int().positive().max(90 * 24 * 60 * 60) });

export class MetaCredentialError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'MetaCredentialError'; }
}

export function metaEnvironmentPrefix(brand: MarketingBrand, platform: MetaPlatform): string {
  return `MARKETING_${brand.toUpperCase()}_${platform.toUpperCase()}`;
}
const instant = (value: string | null | undefined): number => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : Number.NaN;
const envLoginMode = (platform: MetaPlatform, value: string | undefined): MetaLoginMode | null =>
  platform === 'threads' ? 'threads' : value === 'instagram' || value === 'facebook' ? value : null;

export function bootstrapMetaCredential(brand: MarketingBrand, platform: MetaPlatform, env: Environment = process.env): BootstrapMetaCredential {
  const prefix = metaEnvironmentPrefix(brand, platform);
  return { accessToken: env[`${prefix}_ACCESS_TOKEN`] ?? '', expiresAt: env[`${prefix}_TOKEN_EXPIRES_AT`] ?? '',
    scopes: (env[`${prefix}_VERIFIED_SCOPES`] ?? '').split(',').map(value => value.trim()).filter(Boolean),
    loginMode: envLoginMode(platform, env[`${prefix}_LOGIN_MODE`]) };
}

/** Environment-only publisher configuration: the bootstrap credential and the non-secret switches. */
export function metaConfiguration(brand: MarketingBrand, platform: MetaPlatform, env: Environment = process.env): MetaPublisherConfig {
  const prefix = metaEnvironmentPrefix(brand, platform);
  const bootstrap = bootstrapMetaCredential(brand, platform, env);
  if (!bootstrap.loginMode) throw new Error('meta-login-mode-required');
  return { enabled: env.MARKETING_PUBLISH_ENABLED === 'true' && env[`MARKETING_${brand.toUpperCase()}_PUBLISH_ENABLED`] === 'true',
    apiVersion: env[`${prefix}_API_VERSION`] ?? '', apiVersionVerifiedAt: env[`${prefix}_API_VERSION_VERIFIED_AT`] ?? '', loginMode: bootstrap.loginMode,
    accessToken: bootstrap.accessToken, tokenExpiresAt: bootstrap.expiresAt, scopes: bootstrap.scopes,
    approvedAssetHosts: (env.MARKETING_APPROVED_ASSET_HOSTS ?? '').split(',').map(value => value.trim()).filter(Boolean), credentialSource: 'environment' };
}

/** Reads the stored token through the service-role function. A store error is never treated as "no token". */
export async function readStoredMetaToken(db: Database, owner: string, accountId: string): Promise<StoredMetaToken | null> {
  if (!z.uuid().safeParse(owner).success || !z.uuid().safeParse(accountId).success) throw new MetaCredentialError('credential-store-unavailable');
  let response: { data: unknown; error: unknown };
  try { response = await db.rpc('marketing_read_account_token', { p_owner: owner, p_account: accountId }); }
  catch { throw new MetaCredentialError('credential-store-unavailable'); }
  if (response.error || !Array.isArray(response.data) || response.data.length > 1) throw new MetaCredentialError('credential-store-unavailable');
  if (!response.data.length) return null;
  const row = StoredRowSchema.safeParse(response.data[0]);
  if (!row.success) throw new MetaCredentialError('credential-store-unavailable');
  return { accessToken: row.data.access_token, expiresAt: row.data.expires_at, refreshedAt: row.data.refreshed_at, scopes: row.data.scopes, loginMode: row.data.login_mode };
}

/** Non-secret metadata for every stored token of one owner; the #120 scheduler filters it with instagramTokenRefreshDue. */
export async function listMetaTokenMetadata(db: Database, owner: string): Promise<MetaTokenMetadata[]> {
  if (!z.uuid().safeParse(owner).success) throw new MetaCredentialError('credential-store-unavailable');
  const { data, error } = await db.rpc('marketing_account_token_metadata', { p_owner: owner });
  const rows = z.array(MetadataRowSchema).max(20).safeParse(data);
  if (error || !rows.success) throw new MetaCredentialError('credential-store-unavailable');
  return rows.data.map(row => ({ accountId: row.account_id, brand: row.brand, platform: row.platform, expiresAt: row.expires_at, refreshedAt: row.refreshed_at, scopes: row.scopes, loginMode: row.login_mode }));
}

/**
 * True when an unexpired Instagram Login token, or a Facebook Login token (#166), has fewer than ten days left and is
 * old enough for Meta to refresh. A Facebook Login Page token derived from a long-lived user token does not expire,
 * so it is never due.
 */
export function instagramTokenRefreshDue(token: Pick<MetaTokenMetadata, 'expiresAt' | 'refreshedAt' | 'loginMode'>, now = new Date()): boolean {
  const expires = instant(token.expiresAt); const refreshed = instant(token.refreshedAt);
  return (token.loginMode === 'instagram' || token.loginMode === 'facebook') && Number.isFinite(expires) && Number.isFinite(refreshed) && expires > now.getTime() &&
    expires - now.getTime() < INSTAGRAM_TOKEN_REFRESH_WINDOW_MS && now.getTime() - refreshed >= INSTAGRAM_TOKEN_MIN_AGE_MS;
}

/** The stored token wins while unexpired; the environment value is the bootstrap. Holds carry a precise code. */
export function chooseMetaCredential(stored: StoredMetaToken | null, bootstrap: BootstrapMetaCredential, now = new Date()): ChosenMetaCredential {
  const live = (expiresAt: string) => Number.isFinite(instant(expiresAt)) && instant(expiresAt) > now.getTime();
  if (stored && live(stored.expiresAt)) return { source: 'database', accessToken: stored.accessToken, expiresAt: stored.expiresAt, scopes: stored.scopes, loginMode: stored.loginMode, refreshedAt: stored.refreshedAt };
  if (bootstrap.accessToken && live(bootstrap.expiresAt)) {
    if (!bootstrap.loginMode) return { hold: 'meta-login-mode-required' };
    return { source: 'environment', accessToken: bootstrap.accessToken, expiresAt: bootstrap.expiresAt, scopes: bootstrap.scopes, loginMode: bootstrap.loginMode, refreshedAt: null };
  }
  if (stored) return { hold: 'access-token-expired' };
  if (!bootstrap.accessToken) return { hold: 'access-token-missing' };
  return { hold: Number.isFinite(instant(bootstrap.expiresAt)) ? 'access-token-expired' : 'access-token-expiry-unverified' };
}

/**
 * Publisher configuration for one stored account. A held configuration has
 * no token at all, so the publisher's gate stops before any Graph request.
 */
export async function resolveMetaPublisherConfig(db: Database, owner: string, account: MetaCredentialAccount, env: Environment = process.env, now = new Date()): Promise<MetaPublisherConfig> {
  const prefix = metaEnvironmentPrefix(account.brand, account.platform);
  const bootstrap = bootstrapMetaCredential(account.brand, account.platform, env);
  const base = { enabled: env.MARKETING_PUBLISH_ENABLED === 'true' && env[`MARKETING_${account.brand.toUpperCase()}_PUBLISH_ENABLED`] === 'true',
    apiVersion: env[`${prefix}_API_VERSION`] ?? '', apiVersionVerifiedAt: env[`${prefix}_API_VERSION_VERIFIED_AT`] ?? '',
    approvedAssetHosts: (env.MARKETING_APPROVED_ASSET_HOSTS ?? '').split(',').map(value => value.trim()).filter(Boolean) };
  const held = (code: string): MetaPublisherConfig => ({ ...base, loginMode: bootstrap.loginMode ?? (account.platform === 'threads' ? 'threads' : 'instagram'),
    accessToken: '', tokenExpiresAt: '', scopes: [], credentialHold: code });
  if (account.user_id !== owner) return held('credential-owner-mismatch');
  let stored: StoredMetaToken | null;
  try { stored = await readStoredMetaToken(db, owner, account.id); }
  catch (error) { return held(error instanceof MetaCredentialError ? error.code : 'credential-store-unavailable'); }
  const chosen = chooseMetaCredential(stored, bootstrap, now);
  if ('hold' in chosen) return held(chosen.hold);
  return { ...base, loginMode: chosen.loginMode, accessToken: chosen.accessToken, tokenExpiresAt: chosen.expiresAt, scopes: chosen.scopes, credentialSource: chosen.source };
}

/**
 * Exchanges an unexpired, at-least-24-hour-old Instagram Login token for a
 * new 60-day token and stores it with a compare-and-set on refreshed_at.
 *
 * Meta documents this endpoint only with the token as the `access_token`
 * query parameter, so that is the one request here that carries it in the URL.
 * The URL is never logged or returned. A network failure, unreadable response
 * or failed store is reported as `uncertain` and is not retried. When the
 * stored token has expired, a live bootstrap token is refreshed into the same
 * row (compare-and-set on the expired row's refreshed_at).
 */
export async function refreshInstagramToken(db: Database, owner: string, account: MetaCredentialAccount,
  options: { env?: Environment; now?: Date; fetcher?: typeof fetch; signal?: AbortSignal } = {}): Promise<InstagramTokenRefreshOutcome> {
  const now = options.now ?? new Date();
  const outcome = (status: Exclude<InstagramTokenRefreshOutcome['status'], 'refreshed'>, code: string): InstagramTokenRefreshOutcome => ({ status, accountId: account.id, code });
  if (account.user_id !== owner) return outcome('held', 'credential-owner-mismatch');
  if (account.platform !== 'instagram') return outcome('held', 'refresh-instagram-only');
  let stored: StoredMetaToken | null;
  try { stored = await readStoredMetaToken(db, owner, account.id); }
  catch { return outcome('held', 'credential-store-unavailable'); }
  const bootstrap = bootstrapMetaCredential(account.brand, account.platform, options.env ?? process.env);
  const fromEnvironment = bootstrap.accessToken ? { accessToken: bootstrap.accessToken, expiresAt: bootstrap.expiresAt, refreshedAt: null, scopes: bootstrap.scopes, loginMode: bootstrap.loginMode } : null;
  // The same order as chooseMetaCredential: the stored token while unexpired,
  // then a live bootstrap, so refresh renews the token the publisher would use.
  const live = (expiresAt: string) => Number.isFinite(instant(expiresAt)) && instant(expiresAt) > now.getTime();
  const current = stored && live(stored.expiresAt) ? stored : fromEnvironment && live(fromEnvironment.expiresAt) ? fromEnvironment : stored ?? fromEnvironment;
  if (!current) return outcome('held', 'access-token-missing');
  if (current.loginMode !== 'instagram' && current.loginMode !== 'facebook') return outcome('held', 'refresh-instagram-login-required');
  const expires = instant(current.expiresAt);
  if (!Number.isFinite(expires)) return outcome('held', 'access-token-expiry-unverified');
  if (expires <= now.getTime()) return outcome('held', 'access-token-expired');
  // The stored refresh time is a lower bound for the token's age. A bootstrap
  // value only has its expiry, and long-lived tokens are issued for 60 days.
  const issued = current.refreshedAt ? instant(current.refreshedAt) : expires - INSTAGRAM_LONG_LIVED_TOKEN_MS;
  if (!Number.isFinite(issued) || now.getTime() - issued < INSTAGRAM_TOKEN_MIN_AGE_MS) return outcome('skipped', 'access-token-too-new');
  // A refreshed token that the store would refuse must never be requested.
  if (!metaScopesStorable(current.scopes)) return outcome('held', 'verified-scopes-invalid');
  const env = options.env ?? process.env;
  let url: URL;
  if (current.loginMode === 'facebook') {
    // #166: Facebook Login renews a long-lived token by exchanging it with the app's id and secret.
    const appId = env.MARKETING_META_APP_ID ?? ''; const appSecret = env.MARKETING_META_APP_SECRET ?? '';
    const version = env[`${metaEnvironmentPrefix(account.brand, account.platform)}_API_VERSION`] ?? '';
    if (!/^\d{1,30}$/.test(appId) || appSecret.length < 16 || !/^v\d+\.\d+$/.test(version)) return outcome('held', 'refresh-app-credentials-missing');
    url = new URL(`${FACEBOOK_TOKEN_ENDPOINT}/${version}/oauth/access_token`);
    url.searchParams.set('grant_type', 'fb_exchange_token');
    url.searchParams.set('client_id', appId);
    url.searchParams.set('client_secret', appSecret);
    url.searchParams.set('fb_exchange_token', current.accessToken);
  } else {
    url = new URL(INSTAGRAM_REFRESH_ENDPOINT);
    url.searchParams.set('grant_type', 'ig_refresh_token');
    url.searchParams.set('access_token', current.accessToken);
  }
  const timeout = AbortSignal.timeout(15000);
  let response: Response;
  try { response = await (options.fetcher ?? fetch)(url.href, { method: 'GET', redirect: 'error', cache: 'no-store', signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout }); }
  catch { return outcome('uncertain', 'refresh-request-uncertain'); }
  if (!response.ok) return outcome(response.status >= 500 ? 'uncertain' : 'failed', `refresh-http-${response.status}`);
  let parsed: z.infer<typeof RefreshResponseSchema>;
  try {
    const body = RefreshResponseSchema.safeParse(await response.json());
    if (!body.success || (body.data.token_type !== undefined && body.data.token_type.toLowerCase() !== 'bearer')) return outcome('uncertain', 'refresh-response-invalid');
    parsed = body.data;
  } catch { return outcome('uncertain', 'refresh-response-invalid'); }
  const expiresAt = new Date(now.getTime() + parsed.expires_in * 1000).toISOString();
  let saved: { data: unknown; error: unknown };
  try {
    saved = await db.rpc('marketing_store_account_token', { p_owner: owner, p_account: account.id, p_expected_refreshed_at: stored?.refreshedAt ?? null,
      p_token: parsed.access_token, p_expires_at: expiresAt, p_scopes: current.scopes, p_login_mode: current.loginMode });
  } catch { return outcome('uncertain', 'refresh-store-failed'); }
  const metadata = z.object({ token: z.object({ expiresAt: z.string(), refreshedAt: z.string() }) }).safeParse(saved.data);
  if (saved.error || !metadata.success) return outcome('uncertain', 'refresh-store-failed');
  return { status: 'refreshed', accountId: account.id, expiresAt: metadata.data.token.expiresAt, refreshedAt: metadata.data.token.refreshedAt };
}
